"""Provision only task-owned disposable resources; never clean up user resources."""
import argparse
import json
from pathlib import Path
import secrets
import subprocess
import time

PREFIX = "console-system-update-test"
LABEL = "console-system-update-test=true"
ROOT = Path(__file__).resolve().parent
ARTIFACTS = ROOT / "artifacts"


def command(*args, stdin=None, check=True, timeout=120):
    try:
        result = subprocess.run(args, input=stdin, text=True, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f'{args[0]} {args[1]} exceeded the {timeout}s fixture command limit') from error
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} {args[1]} failed ({result.returncode}): {result.stderr[-1500:]}")
    return result


def ensure_network():
    result = command("docker", "network", "inspect", PREFIX, check=False)
    if result.returncode:
        command("docker", "network", "create", "--label", LABEL, PREFIX)
    else:
        network = json.loads(result.stdout)[0]
        if network["Labels"].get("console-system-update-test") != "true":
            raise RuntimeError("Existing network is not owned by this task")


def owned_container(name):
    if not name.startswith(PREFIX + "-"):
        raise ValueError("Container name is outside the task namespace")
    # A retained volume can share this name after its container is removed.
    result = command("docker", "container", "inspect", name, check=False)
    if result.returncode:
        return None
    value = json.loads(result.stdout)[0]
    if value["Config"]["Labels"].get("console-system-update-test") != "true":
        raise RuntimeError("Existing container is not owned by this task")
    return value


def mysql_sql(sql):
    owned_container(PREFIX + "-mysql")
    return command("docker", "exec", "-i", PREFIX + "-mysql", "mysql",
                   "--defaults-extra-file=/tmp/test-client.cnf", "--batch",
                   "--skip-column-names", stdin=sql).stdout.strip()


def mysql():
    ensure_network()
    name = PREFIX + "-mysql"
    if owned_container(name) is None:
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        password = secrets.token_hex(24)
        (ARTIFACTS / "mysql-root-password").write_text(password, encoding="utf8")
        (ARTIFACTS / "mysql-client.cnf").write_text(
            f"[client]\nuser=root\npassword={password}\n", encoding="utf8")
        command("docker", "create", "--name", name, "--label", LABEL,
                "--network", PREFIX, "--memory", "1g", "--cpus", "2",
                "--env", "MYSQL_ROOT_PASSWORD_FILE=/tmp/test-root-password",
                "mysql:8.4")
        command("docker", "cp", str(ARTIFACTS / "mysql-root-password"),
                name + ":/tmp/test-root-password")
        command("docker", "cp", str(ARTIFACTS / "mysql-client.cnf"),
                name + ":/tmp/test-client.cnf")
        command("docker", "start", name)
    else:
        command("docker", "start", name)
    deadline = time.monotonic() + 180
    while True:
        try:
            version = mysql_sql("SELECT VERSION();")
            break
        except RuntimeError:
            if time.monotonic() > deadline:
                raise
            time.sleep(2)
    command("docker", "exec", "--user", "root", name, "chmod", "600",
            "/tmp/test-client.cnf")
    # No global schema grants: the adapter must accept schema-only privileges.
    app_password = secrets.token_hex(24)
    (ARTIFACTS / "mysql-app-password").write_text(app_password, encoding="utf8")
    mysql_sql(f"""CREATE DATABASE IF NOT EXISTS console_test;
CREATE DATABASE IF NOT EXISTS untouched_sibling;
CREATE USER IF NOT EXISTS 'console_test'@'%' IDENTIFIED BY '{app_password}';
ALTER USER 'console_test'@'%' IDENTIFIED BY '{app_password}';
GRANT ALL PRIVILEGES ON console_test.* TO 'console_test'@'%';
GRANT PROCESS ON *.* TO 'console_test'@'%';
CREATE USER IF NOT EXISTS 'console_readonly'@'%' IDENTIFIED BY '{app_password}';
ALTER USER 'console_readonly'@'%' IDENTIFIED BY '{app_password}';
GRANT SELECT ON console_test.* TO 'console_readonly'@'%';
GRANT PROCESS ON *.* TO 'console_readonly'@'%';
CREATE TABLE IF NOT EXISTS untouched_sibling.sentinel (id INT PRIMARY KEY, value VARCHAR(80));
INSERT IGNORE INTO untouched_sibling.sentinel VALUES (1, 'must-survive-every-restore');
""")
    info = owned_container(name)
    result = {"version": version, "image": info["Image"],
              "ip": info["NetworkSettings"]["Networks"][PREFIX]["IPAddress"],
              "schema": "console_test", "username": "console_test",
              "sibling": mysql_sql("SELECT * FROM untouched_sibling.sentinel;"),
              "publishedPorts": info["HostConfig"]["PortBindings"],
              "status": "environment-ready-not-feature-acceptance"}
    (ARTIFACTS / "mysql-environment.json").write_text(json.dumps(result, indent=2), encoding="utf8")
    print(json.dumps(result))


def vm():
    ensure_network()
    name = PREFIX + "-vm"
    if owned_container(name) is None:
        volume = command("docker", "volume", "inspect", name, check=False)
        if not volume.returncode:
            labels = json.loads(volume.stdout)[0]["Labels"] or {}
            if labels.get("console-system-update-test") != "true":
                raise RuntimeError("Existing VM volume is not owned by this task")
        else:
            command("docker", "volume", "create", "--label", LABEL, name)
        command("docker", "run", "-d", "--name", name, "--label", LABEL,
                "--network", PREFIX, "--cap-drop", "ALL", "--security-opt",
                "no-new-privileges", "--memory", "4g", "--cpus", "3",
                "--mount", f"type=volume,source={name},target=/vm",
                "console-system-update-test-vm:local")
    else:
        command("docker", "start", name)
    info = owned_container(name)
    print(json.dumps({"container": name, "user": info["Config"]["User"],
                      "privileged": info["HostConfig"]["Privileged"],
                      "mountTypes": [m["Type"] for m in info["Mounts"]],
                      "status": "booting-not-feature-acceptance"}))


def probe():
    name = PREFIX + "-vm"
    owned_container(name)
    result = command("docker", "exec", name, "ssh", "-i", "/vm/id_ed25519",
                     "-p", "2222", "-o", "ConnectTimeout=5", "-o", "BatchMode=yes",
                     "-o", "StrictHostKeyChecking=accept-new", "tester@127.0.0.1",
                     "ps -p 1 -o comm=; systemctl is-system-running; systemd --version; uname -a; cat /proc/sys/kernel/random/boot_id")
    print(result.stdout)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["mysql", "vm", "probe"])
    args = parser.parse_args()
    {"mysql": mysql, "vm": vm, "probe": probe}[args.action]()
