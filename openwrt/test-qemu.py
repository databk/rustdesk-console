#!/usr/bin/env python3
"""Boot an isolated ARM64 OpenWrt VM and validate the installed Console APKs.

Requires Linux qemu-system-aarch64, e2fsprogs and an empty work directory.
No network interface, host bridge, firmware flashing or privileged mount is used.
"""
import argparse
import gzip
from pathlib import Path
import re
import select
import shutil
import socket
import subprocess
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--artifacts', type=Path, required=True, help='kernel.bin, rootfs.img.gz and deps/*.apk')
parser.add_argument('--packages', type=Path, required=True, help='One version of each Console APK')
parser.add_argument('--work', type=Path, required=True, help='Empty disposable directory')
args = parser.parse_args()
work = args.work.resolve()
work.mkdir(parents=True, exist_ok=True)
if any(work.iterdir()):
    raise SystemExit('Work directory must be empty; existing disks are never overwritten')
payload = work / 'payload'
payload.mkdir()
for source in [args.artifacts / 'deps', args.packages]:
    for apk in source.glob('*.apk'):
        shutil.copy2(apk, payload / apk.name)
for pattern in ['rustdesk-console-*.apk', 'luci-app-rustdesk-console-*.apk']:
    if len(list(payload.glob(pattern))) != 1:
        raise SystemExit(f'Expected exactly one {pattern}')
shutil.copy2(Path(__file__).with_name('test-vm.mjs'), payload)
root = work / 'root.img'
with gzip.open(args.artifacts / 'rootfs.img.gz', 'rb') as source, root.open('wb') as dest:
    shutil.copyfileobj(source, dest)
with root.open('r+b') as stream:
    stream.truncate(1024 * 1024 * 1024)
check = subprocess.run(['e2fsck', '-fy', str(root)], capture_output=True)
if check.returncode not in (0, 1):
    raise RuntimeError(check.stderr.decode())
subprocess.run(['resize2fs', str(root)], check=True, capture_output=True)
data = work / 'input.img'
with data.open('wb') as stream:
    stream.truncate(256 * 1024 * 1024)
subprocess.run(['mkfs.ext4', '-q', '-F', '-d', str(payload), str(data)], check=True)
serial_path = work / 'serial.sock'
qemu_log = (work / 'qemu.log').open('w')
vm = subprocess.Popen([
    'qemu-system-aarch64', '-machine', 'virt', '-cpu', 'cortex-a53', '-smp', '2', '-m', '1024',
    # With these two virtio-mmio devices, virt enumerates the input disk first.
    '-kernel', str(args.artifacts / 'kernel.bin'), '-append', 'root=/dev/vdb rw rootwait console=ttyAMA0',
    '-drive', f'file={root},if=none,format=raw,id=root', '-device', 'virtio-blk-device,drive=root',
    '-drive', f'file={data},if=none,format=raw,id=input,readonly=on', '-device', 'virtio-blk-device,drive=input',
    '-nic', 'none', '-display', 'none', '-monitor', 'none',
    '-serial', f'unix:{serial_path},server=on,wait=off',
], stdout=qemu_log, stderr=subprocess.STDOUT)
serial = socket.socket(socket.AF_UNIX)
log = (work / 'serial.log').open('w')
buffer = ''

def receive_until(pattern, timeout=180):
    global buffer
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if 'Kernel panic' in buffer:
            raise RuntimeError('Guest kernel panic: ' + buffer[-2500:])
        match = re.search(pattern, buffer)
        if match:
            received = buffer[:match.end()]
            buffer = buffer[match.end():]
            return match, received
        if vm.poll() is not None:
            raise RuntimeError(f'QEMU exited {vm.returncode}; see qemu.log')
        if select.select([serial], [], [], 1)[0]:
            chunk = serial.recv(65536).decode(errors='replace')
            if not chunk:
                raise RuntimeError('Serial connection closed')
            buffer += chunk
            log.write(chunk)
            log.flush()
    raise TimeoutError(f'Timeout waiting for {pattern}; tail: {buffer[-2500:]}')

def command(shell, timeout=240):
    marker = 'RDC287_' + uuid.uuid4().hex
    serial.sendall((shell + '; rc=$?; echo ' + marker + ':$rc\n').encode())
    match, output = receive_until(marker + r':([0-9]+)', timeout)
    print(output.strip(), flush=True)
    if match.group(1) != '0':
        raise RuntimeError('Guest command failed: ' + shell)

try:
    for _ in range(100):
        try:
            serial.connect(str(serial_path))
            break
        except (FileNotFoundError, ConnectionRefusedError):
            time.sleep(0.1)
    else:
        raise RuntimeError('QEMU serial socket did not appear')
    receive_until(r'Please press Enter to activate this console\.')
    serial.sendall(b'\n')
    receive_until(r'root@[^:\r\n]+:.*#')
    command('uname -m; apk --print-arch; cat /etc/apk/arch; cat /etc/openwrt_release')
    command('mkdir -p /mnt/input; mount -o ro /dev/vda /mnt/input')
    command('apk --no-network --allow-untrusted add --simulate /mnt/input/*.apk')
    command('apk --no-network --allow-untrusted add /mnt/input/*.apk', timeout=360)
    command('[ "$(uci -q get rustdesk-console.main.enabled)" = 0 ] && [ ! -e /srv/rustdesk-console ] && [ ! -e /etc/rustdesk-console/credentials ]')
    command('uci set rustdesk-console.main.enabled=1; uci commit rustdesk-console; /etc/init.d/rustdesk-console start')
    command('OPENWRT_PACKAGE_TEST=1 /usr/lib/rustdesk-console/backend/node /mnt/input/test-vm.mjs initial', timeout=360)
    command('/etc/init.d/rustdesk-console restart')
    command('OPENWRT_PACKAGE_TEST=1 /usr/lib/rustdesk-console/backend/node /mnt/input/test-vm.mjs restart', timeout=360)
    print('Rebooting disposable ARM64 VM', flush=True)
    serial.sendall(b'sync; reboot\n')
    receive_until(r'Please press Enter to activate this console\.', timeout=240)
    serial.sendall(b'\n')
    receive_until(r'root@[^:\r\n]+:.*#')
    command('mount -o ro /dev/vda /mnt/input')
    command('OPENWRT_PACKAGE_TEST=1 /usr/lib/rustdesk-console/backend/node /mnt/input/test-vm.mjs reboot', timeout=360)
    # Exercise the package's stop hook while both services are still running.
    command('apk --no-network del luci-app-rustdesk-console rustdesk-console')
    command('[ -f /srv/rustdesk-console/rustdesk-console.db ] && [ -f /etc/rustdesk-console/credentials ]')
    command('[ ! -e /etc/rc.d/S95rustdesk-console ] && ! pidof rustdesk-console-web node')
    print('ARM64_VM_PACKAGE_TEST_OK', flush=True)
finally:
    vm.terminate()
    try:
        vm.wait(timeout=15)
    except subprocess.TimeoutExpired:
        vm.kill()
        vm.wait()
    serial.close()
    log.close()
    qemu_log.close()
