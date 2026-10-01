"""Actual Compose adapters using unpublished immutable local test images."""
import argparse
import hashlib
import json
import re
from pathlib import Path
import secrets
import socket
import time
import uuid
from environment import command, owned_container, ensure_network, ARTIFACTS, PREFIX, LABEL

DRIVER = PREFIX + "-driver-persistent"
FIXTURE_VOLUME = PREFIX + "-fixtures"
HOST_ROOT = "/var/lib/docker/volumes/" + FIXTURE_VOLUME + "/_data"
FIXTURE_TARGET = "/etc/rustdesk-console/test-fixture"


def inside(*args, stdin=None):
    return command("docker", "exec", "-i", DRIVER, *args, stdin=stdin).stdout.strip()


def write_remote(path, value):
    # Only task-owned Linux host paths are writable through this helper.
    if not path.startswith(HOST_ROOT + "/"):
        raise ValueError("Path outside isolated fixture root")
    content = json.dumps(value, separators=(",", ":")) + "\n"
    inside("node", "-e", "const fs=require('fs');const p=process.argv[1];fs.mkdirSync(require('path').dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,fs.readFileSync(0),{mode:0o600});", path, stdin=content)
    # Windows text-mode stdin may change LF to CRLF; hash the persisted bytes.
    return inside("node", "-e", "console.log(require('crypto').createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('hex'))", path)


def load_images(catalog=None):
    return json.loads(Path(catalog or ARTIFACTS / "local-oci-fixtures.json").read_text())


def publish(sources=None, catalog=None, tag_suffix=None):
    if sources and (not catalog or not tag_suffix):
        raise ValueError("Explicit image sources require a separate catalog and new tag suffix")
    if catalog and Path(catalog).exists():
        raise ValueError("Refusing to overwrite an existing acceptance image catalog")
    if tag_suffix and not re.fullmatch(r"[a-z0-9][a-z0-9-]*", tag_suffix):
        raise ValueError("Unsafe fixture tag suffix")
    selected = json.loads(Path(sources).read_text()) if sources else {}
    registry_name = PREFIX + "-registry-loopback"
    registry = owned_container(registry_name)
    if registry is None or registry["HostConfig"]["NetworkMode"] != "host":
        raise RuntimeError("Task registry must bind only an ephemeral engine-loopback port")
    logs = command("docker", "logs", registry_name)
    port = re.findall(r"listening on 127\.0\.0\.1:(\d+)", logs.stdout + logs.stderr)[-1]
    result = {}
    for key, source, repo, tag in [
        ("old", PREFIX + "-backend:fixture-old", "backend", "old"),
        ("new", PREFIX + "-backend:fixture-new", "backend", "new"),
        ("web", PREFIX + "-web:local", "web", "current"),
        ("web-new", PREFIX + "-web:target-1.6.1", "web", "new"),
        *([("production", selected["production"], "backend", "production")] if "production" in selected else []),
    ]:
        if sources:
            source = selected[key]
            if not re.fullmatch(r"sha256:[a-f0-9]{64}", source):
                raise ValueError("Final image sources must be immutable local image IDs")
        if tag_suffix:
            tag += "-" + tag_suffix
        target = f"127.0.0.1:{port}/console-system-update-test/{repo}:{tag}"
        command("docker", "tag", source, target)
        command("docker", "push", target)
        info = json.loads(command("docker", "image", "inspect", target).stdout)[0]
        canonical = next(ref for ref in info["RepoDigests"] if ref.startswith(target.rsplit(":", 1)[0] + "@"))
        result[key] = {"url": canonical, "sha256": canonical.split("sha256:")[1],
                       "imageId": info["Id"], "size": info["Size"],
                       "taggedUrl": target,
                       "sourceCommit": info["Config"]["Labels"]["org.opencontainers.image.revision"]}
    ARTIFACTS.mkdir(exist_ok=True, parents=True)
    Path(catalog or ARTIFACTS / "local-oci-fixtures.json").write_text(json.dumps(result, indent=2), encoding="utf8")
    print(json.dumps({"publishedTo": "task-local-loopback-registry", "images": result}))


def driver():
    volume = command("docker", "volume", "inspect", FIXTURE_VOLUME, check=False)
    if volume.returncode:
        command("docker", "volume", "create", "--label", LABEL, FIXTURE_VOLUME)
        volume = command("docker", "volume", "inspect", FIXTURE_VOLUME)
    details = json.loads(volume.stdout)[0]
    if details["Mountpoint"] != HOST_ROOT or (details.get("Labels") or {}).get("console-system-update-test") != "true":
        raise RuntimeError("Fixture volume identity or engine path does not match")
    if owned_container(DRIVER) is None:
        command("docker", "run", "-d", "--name", DRIVER, "--label", LABEL,
                "--entrypoint", "sleep", "--memory", "512m", "--cpus", "1",
                "--mount", "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock",
                "--mount", "type=volume,source=" + FIXTURE_VOLUME + ",target=" + HOST_ROOT,
                PREFIX + "-backend:fixture-old", "infinity")
    else:
        command("docker", "start", DRIVER)


def component(name, version, artifact, release_id):
    release_artifact = {key: artifact[key] for key in ["url", "sha256", "size"]}
    release_artifact.update({"kind": "oci", "platform": {"os": "linux", "arch": "x64", "libc": "musl"}, "name": name + "-linux-x64"})
    manifest = {"schemaVersion": 1, "repository": "databk/rustdesk-console" + ("-web" if name == "web" else ""),
                "component": name, "version": version, "releaseId": release_id, "tag": "v" + version,
                "sourceCommit": artifact["sourceCommit"], "publishedAt": "2026-09-29T00:00:00.000Z",
                "peerVersionRange": ">=1.0.0 <2.0.0", "updaterProtocol": 1, "maintenanceProtocol": 1,
                "bundleFormat": 1, "artifacts": [release_artifact]}
    return {"version": version, "sourceCommit": artifact["sourceCommit"], "artifact": release_artifact, "manifest": manifest}


def compose(name, *args):
    root = HOST_ROOT + "/" + name
    return inside("docker", "compose", "--project-name", PREFIX + "-" + name,
                  "--project-directory", root, "--file", root + "/docker-compose.yml",
                  "--file", root + "/docker-compose.override.yml", *args)


def prepare(name, database, port=None, components="backend", read_only_worker_data=False, fixture_catalog=None):
    if not name.replace("-", "").isalnum():
        raise ValueError("Unsafe fixture identifier")
    if len((PREFIX + "-" + name + "-backend-1").encode("utf8")) > 63:
        raise ValueError("Fixture service name exceeds the Docker DNS label limit")
    ensure_network()
    driver()
    if port is None:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
    images = load_images(fixture_catalog)
    root = HOST_ROOT + "/" + name
    state, data, ipc, maintenance = [root + "/" + item for item in ["state", "data", "ipc", "maintenance"]]
    # Linux Unix sockets have a 108-byte path limit, including the terminator.
    ipc = HOST_ROOT + "/ipc/" + uuid.uuid4().hex[:8]
    for directory in [state, data, ipc, maintenance, root + "/fixture"]:
        inside("mkdir", "-p", directory)
    inside("chmod", "700", state)
    inside("chmod", "755", root, data, maintenance)
    inside("chown", "1000:1000", data)
    old = component("backend", "1.9.0", images["old"], 190)
    target = component("backend", "1.9.1", images["new"], 191)
    web = component("web", "1.6.0", images["web"], 160)
    if components not in ["backend", "web", "both"]:
        raise ValueError("Unknown test fixture component scenario")
    targets = {"backend": old if components == "web" else target,
               "web": web if components == "backend" else component("web", "1.6.1", images["web-new"], 161)}
    env = {"JWT_SECRET": secrets.token_hex(32), "DB_TYPE": database, "DATA_DIR": "/data",
           "SYSTEM_UPDATE_SOCKET": ipc + "/control.sock",
           "SYSTEM_UPDATE_MAINTENANCE_FILE": maintenance + "/maintenance.json"}
    db = {"kind": "sqlite", "path": data + "/rustdesk-console.db"}
    if database == "mysql":
        password = (ARTIFACTS / "mysql-app-password").read_text().strip()
        env.update({"DB_HOST": PREFIX + "-mysql", "DB_PORT": "3306", "DB_USERNAME": "console_test",
                    "DB_DATABASE": "console_test", "DB_PASSWORD": password})
        inside("node", "-e", "require('fs').writeFileSync(process.argv[1],require('fs').readFileSync(0),{mode:0o600})", state + "/mysql-password", stdin=password)
        db = {"kind": "mysql", "host": PREFIX + "-mysql", "port": 3306, "database": "console_test",
              "username": "console_test", "passwordFile": state + "/mysql-password", "exclusiveSchema": True}
    helper_env = {"SYSTEM_UPDATE_ROLE": "updater", "SYSTEM_UPDATE_INSTALLATION": state + "/installation.json",
                  "SYSTEM_UPDATE_SOCKET": ipc + "/control.sock", "SYSTEM_UPDATE_SOCKET_GID": "1000",
                  "SYSTEM_UPDATE_MAINTENANCE_FILE": maintenance + "/maintenance.json"}
    mounts = [{"source": root, "target": root, "readOnly": False},
              {"source": ipc, "target": ipc, "readOnly": False},
              {"source": root + "/fixture", "target": FIXTURE_TARGET, "readOnly": True}]
    services = {
        "backend": {"image": images["old"]["url"], "environment": env, "volumes": [data + ":/data", ipc + ":" + ipc + ":ro", maintenance + ":" + maintenance + ":ro"], "labels": {"console-system-update-test": "true"}},
        "web": {"image": images["web"]["url"], "environment": {"BACKEND_URL": "http://" + PREFIX + "-" + name + "-backend-1:3000"}, "ports": [f"127.0.0.1:{port}:80"], "labels": {"console-system-update-test": "true"}},
        "updater": {"image": images["old"]["url"], "command": ["node", "/app/dist/main.js", "--system-update-mode=updater"], "environment": helper_env,
                    "volumes": [root + ":" + root, ipc + ":" + ipc, root + "/fixture:" + FIXTURE_TARGET + ":ro", "/var/run/docker.sock:/var/run/docker.sock"],
                    "restart": "on-failure", "labels": {"console-system-update-test": "true"}},
    }
    for service, memory in [("backend", "320m"), ("updater", "256m"), ("web", "96m")]:
        services[service]["mem_limit"] = memory
        services[service]["cpus"] = 0.5
    # Preserve old fixture networks without exhausting Docker's subnet pool.
    # Every application and worker uses the existing task-owned network; unique
    # container DNS avoids cross-fixture aliases and also reaches external MySQL.
    network_name = PREFIX
    config = {"services": services, "networks": {"default": {"external": True, "name": network_name}}}
    if read_only_worker_data:
        services["updater"]["volumes"].append(data + ":" + data + ":ro")
        mounts.append({"source": data, "target": data, "readOnly": True})
    base_hash = write_remote(root + "/docker-compose.yml", config)
    write_remote(root + "/docker-compose.override.yml", {"services": {}})
    effective = compose(name, "config", "--format", "json")
    neutral = inside("node", "-e", "const x=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(require('/app/dist/updater/adapters/compose').configurationFingerprint(x,['backend','web','updater']))", stdin=effective)
    installation = {"schemaVersion": 1, "installationId": str(uuid.uuid4()), "deployment": "managed-compose",
                    "platform": {"os": "linux", "arch": "x64", "libc": "musl"}, "stateDir": state, "dataDir": data,
                    "ipcDir": ipc, "maintenanceFile": maintenance + "/maintenance.json",
                    "backendHealthUrl": "http://backend:3000/api/system-update/health", "webHealthUrl": "http://web/system-update-health.json",
                    "current": {"backend": old, "web": web}, "database": db,
                    "compose": {"projectName": PREFIX + "-" + name, "projectDirectory": root,
                                "files": [root + "/docker-compose.yml", root + "/docker-compose.override.yml"],
                                "overrideFile": root + "/docker-compose.override.yml", "configFiles": {root + "/docker-compose.yml": base_hash},
                                "configDigest": neutral, "services": {"backend": "backend", "web": "web", "updater": "updater"},
                                "workerMounts": mounts, "workerNetwork": network_name, "workerImage": images["old"]["url"]}}
    installation["backendHealthUrl"] = "http://" + PREFIX + "-" + name + "-backend-1:3000/api/system-update/health"
    installation["webHealthUrl"] = "http://" + PREFIX + "-" + name + "-web-1/system-update-health.json"
    write_remote(state + "/installation.json", installation)
    write_remote(root + "/fixture/catalog.json", {"testOnly": PREFIX, "targets": targets, "archives": {}})
    compose(name, "up", "-d", "--pull", "never")
    print(json.dumps({"fixture": name, "database": database, "state": state, "url": f"http://127.0.0.1:{port}", "scope": "unpublished-local-fixture"}))


def ipc_request(name, operation, body=None):
    installation = json.loads(inside("cat", HOST_ROOT + "/" + name + "/state/installation.json"))
    path = installation["ipcDir"] + "/control.sock"
    payload = json.dumps({"operation": operation, "body": body or {}, "actorId": "integration-admin"})
    script = "const h=require('http');const q=h.request({socketPath:process.argv[1],method:'POST',path:'/'},r=>{r.pipe(process.stdout);if(r.statusCode>=400)process.exitCode=1});q.on('error',e=>{console.error(e.code);process.exitCode=1});q.end(require('fs').readFileSync(0));"
    return json.loads(inside("node", "-e", script, path, stdin=payload))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["publish", "prepare", "capabilities", "plans", "current", "start"])
    parser.add_argument("--name", default="sqlite-normal")
    parser.add_argument("--database", choices=["sqlite", "mysql"], default="sqlite")
    parser.add_argument("--port", type=int)
    parser.add_argument("--fixture-catalog", help="Separate immutable evidence catalog")
    parser.add_argument("--sources", help="JSON mapping roles to immutable local image IDs")
    parser.add_argument("--tag-suffix", help="New local registry tag suffix; preserve historical tags")
    args = parser.parse_args()
    if args.action == "publish":
        publish(args.sources, args.fixture_catalog, args.tag_suffix)
    elif args.action == "prepare":
        prepare(args.name, args.database, args.port, fixture_catalog=args.fixture_catalog)
    elif args.action == "start":
        plan = ipc_request(args.name, "plans")
        if not plan["executable"]:
            raise RuntimeError(json.dumps(plan["blockers"]))
        print(json.dumps(ipc_request(args.name, "jobs", {"planId": plan["planId"], "idempotencyKey": str(uuid.uuid4()), "acknowledgeDowntime": True})))
    else:
        print(json.dumps(ipc_request(args.name, args.action)))
