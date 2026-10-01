#!/bin/sh
set -eu
umask 077
cd /vm
image=debian-12-genericcloud-amd64.qcow2
base=https://cloud.debian.org/images/cloud/bookworm/latest
if [ ! -f base.qcow2 ]; then
  curl --fail --location --retry 3 --proto "=https" "$base/SHA512SUMS" -o SHA512SUMS
  curl --fail --location --retry 3 --proto "=https" "$base/$image" -o "$image"
  awk -v name="$image" '$2 == name || $2 == "*"name { print }' SHA512SUMS > image.sha512
  test -s image.sha512
  sha512sum -c image.sha512
  mv "$image" base.qcow2
fi
if [ ! -f disk.qcow2 ]; then
  ssh-keygen -q -t ed25519 -N "" -f id_ed25519
  key=$(cat id_ed25519.pub)
  cat > user-data <<EOF
#cloud-config
hostname: console-system-update-test
users:
  - name: tester
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - $key
ssh_pwauth: false
disable_root: true
EOF
  printf "instance-id: console-system-update-test\nlocal-hostname: console-system-update-test\n" > meta-data
  genisoimage -quiet -output seed.iso -volid cidata -joliet -rock user-data meta-data
  qemu-img create -f qcow2 -F qcow2 -b /vm/base.qcow2 disk.qcow2 16G
fi
exec qemu-system-x86_64 \
  -machine q35 -accel tcg,thread=multi -cpu max -smp 2 -m 1280 \
  -drive file=/vm/disk.qcow2,format=qcow2,if=virtio \
  -drive file=/vm/seed.iso,format=raw,if=virtio,readonly=on \
  -netdev user,id=net0,hostfwd=tcp:0.0.0.0:2222-:22 \
  -device virtio-net-pci,netdev=net0 \
  -display none -serial stdio -monitor none -no-reboot
