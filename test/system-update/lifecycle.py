"""Real application/Compose lifecycle evidence, using unpublished test artifacts."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from compose_fixture import (ARTIFACTS, HOST_ROOT, PREFIX, command, compose,
                             inside, ipc_request, prepare, write_remote)
from environment import mysql_sql

SCENARIOS = {
    "normal": [],
    "before-commit": [{"event": "before:commit_decided", "action": "kill"}],
    "after-commit": [{"event": "after:commit_decided", "action": "kill"}],
    "rollback": [{"event": "verify:intent", "action": "throw"}],
    "after-restore": [{"event": "verify:intent", "action": "throw"},
                      {"event": "after:restore_decided", "action": "kill"}],
    "commit-write": [{"event": "business_reopened", "action": "pause"}],
    "restore-write": [{"event": "verify:intent", "action": "throw"},
                      {"event": "business_reopened", "action": "pause"}],
}


def request(base, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(base + path, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=12) as response:
        return json.load(response)


def wait_until(operation, predicate, timeout=180):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            last = operation()
            if predicate(last):
                return last
        except (RuntimeError, OSError, ValueError) as error:
            last = type(error).__name__
        time.sleep(1)
    raise RuntimeError(f"Condition timed out; last safe result: {last}")


def login(base):
    # These are the legacy credentials of this disposable test installation only.
    value = request(base, "/api/login", {"username": "databk", "password": "databk",
                                          "type": "account", "deviceInfo": {"type": "browser"}})
    return value["access_token"]


def record(name, job_id):
    path = HOST_ROOT + "/" + name + "/state/jobs/" + job_id + ".json"
    return json.loads(inside("cat", path))


def containers(name):
    values = json.loads(command("docker", "inspect", *[
        PREFIX + "-" + name + "-" + service + "-1"
        for service in ["backend", "web", "updater"]
    ]).stdout)
    return {value["Config"]["Labels"]["com.docker.compose.service"]:
            {"id": value["Id"], "image": value["Image"]} for value in values}


def check_versions(base, backend, web_version="1.6.0"):
    direct = request(base, "/api/system-update/health")
    web = request(base, "/system-update-health.json")
    assert direct["version"] == backend and direct["ready"]
    assert web["version"] == web_version and web["ready"]
    return {"backend": direct, "web": web}


def run(database, scenario, components="backend", fixture_catalog=None):
    mode = "" if components == "backend" else components + "-"
    slug = {"commit-write": "cwrite", "restore-write": "rwrite"}.get(scenario, scenario)
    name = database + "-" + mode + slug + "-" + uuid.uuid4().hex[:6]
    root = HOST_ROOT + "/" + name
    sibling = mysql_sql("SELECT * FROM untouched_sibling.sentinel;") if database == "mysql" else None
    prepare(name, database, components=components, fixture_catalog=fixture_catalog)
    base = "http://" + command("docker", "port", PREFIX + "-" + name + "-web-1", "80").stdout.strip()
    wait_until(lambda: request(base, "/api/system-update/health"),
               lambda value: value.get("ready") and value.get("version") == "1.9.0")
    wait_until(lambda: ipc_request(name, "capabilities"), lambda value: value["ready"])
    assert ipc_request(name, "current")["job"] is None, "Helper must not start an update automatically"
    initial_containers = containers(name)
    token = login(base)
    # Official baseline's user-group partial unique index is SQLite-specific.
    # Strategies provide the same real authorized write on both databases.
    business_path = "/api/strategies" if database == "mysql" else "/api/user-groups"
    before_name = "before-update-" + uuid.uuid4().hex
    request(base, business_path, {"name": before_name}, token)
    write_remote(root + "/data/integration-sentinel.json", {"value": "before-update"})
    write_remote(root + "/fixture/fault.json", SCENARIOS[scenario])
    plan = ipc_request(name, "plans")
    assert plan["executable"], plan["blockers"]
    body = {"planId": plan["planId"], "idempotencyKey": str(uuid.uuid4()), "acknowledgeDowntime": True}
    accepted = ipc_request(name, "jobs", body)
    job_id = accepted["jobId"]
    assert ipc_request(name, "jobs", body)["jobId"] == job_id
    worker = PREFIX + "-" + name + "-update-" + job_id
    command("docker", "update", "--memory", "256m", "--memory-swap", "256m", "--cpus", "0.5", worker)
    observed_faults = []
    external_interruptions = []

    def interrupt_worker(event):
        before = json.loads(command("docker", "inspect", worker).stdout)[0]
        assert before["State"]["Running"]
        assert before["Config"]["Labels"]["io.rustdesk-console.update-job"] == job_id
        killed = command("docker", "kill", "--signal", "KILL", worker)
        external_interruptions.append({"event": event, "containerId": before["Id"],
                                       "startedAt": before["State"]["StartedAt"],
                                       "pidBeforeKill": before["State"]["Pid"],
                                       "externalKillExitCode": killed.returncode})
        observed_faults.append(event)
    for fault in SCENARIOS[scenario]:
        if fault["action"] != "kill":
            continue
        marker = root + "/state/test-fault-" + job_id + "-" + fault["event"].replace(":", "-")
        wait_until(lambda: inside("test", "-f", marker), lambda _: True, 300)
        interrupt_worker(fault["event"])
    post_name = None
    if scenario.endswith("-write"):
        marker = root + "/state/test-fault-" + job_id + "-business_reopened"
        wait_until(lambda: inside("test", "-f", marker), lambda _: True, 300)
        paused = record(name, job_id)
        expected_decision = "restore_decided" if scenario == "restore-write" else "commit_decided"
        assert paused["decision"] == expected_decision
        assert paused["view"]["status"] == "running"
        expected = "1.9.0" if scenario == "restore-write" or components == "web" else "1.9.1"
        expected_web = "1.6.0" if scenario == "restore-write" or components == "backend" else "1.6.1"
        check_versions(base, expected, expected_web)
        # A genuine authorized request must succeed after reopening business traffic.
        post_name = "accepted-after-decision-" + uuid.uuid4().hex
        request(base, business_path, {"name": post_name}, token)
        write_remote(root + "/data/accepted-after-decision.json", {"name": post_name})
        interrupt_worker("business_reopened")
    terminal = wait_until(lambda: ipc_request(name, "current")["job"],
                          lambda job: job and job["status"] in ["succeeded", "rolled_back", "failed", "recovery_required"], 360)
    expected_status = "rolled_back" if scenario in ["before-commit", "rollback", "after-restore", "restore-write"] else "succeeded"
    assert terminal["status"] == expected_status, terminal
    recovered_worker = json.loads(command("docker", "inspect", worker).stdout)[0]
    for interruption in external_interruptions:
        assert recovered_worker["Id"] == interruption["containerId"]
        assert recovered_worker["State"]["StartedAt"] != interruption["startedAt"]
        assert recovered_worker["Config"]["Labels"]["io.rustdesk-console.update-job"] == job_id
    details = record(name, job_id)
    assert details["decision"] == ("restore_decided" if expected_status == "rolled_back" else "commit_decided")
    version = "1.9.0" if expected_status == "rolled_back" or components == "web" else "1.9.1"
    web_version = "1.6.0" if expected_status == "rolled_back" or components == "backend" else "1.6.1"
    health = check_versions(base, version, web_version)
    final_containers = containers(name)
    for component in terminal["components"]:
        service = component["component"]
        if component["action"] == "unchanged":
            assert initial_containers[service]["image"] == final_containers[service]["image"]
    if components == "web":
        for service in ["backend", "updater"]:
            assert initial_containers[service] == final_containers[service], "Unchanged service was recreated"
    groups = request(base, business_path + "?current=1&pageSize=100", token=token)["data"]
    names = {group["name"] for group in groups}
    assert before_name in names
    assert json.loads(inside("cat", root + "/data/integration-sentinel.json"))["value"] == "before-update"
    if post_name:
        assert post_name in names, "Accepted post-decision database write was lost"
        assert json.loads(inside("cat", root + "/data/accepted-after-decision.json"))["name"] == post_name
    compose(name, "restart", "backend", "web", "updater")
    wait_until(lambda: check_versions(base, version, web_version), lambda _: True)
    resumed = wait_until(lambda: ipc_request(name, "current"), lambda value: value["job"]["jobId"] == job_id)
    assert resumed["job"]["status"] == expected_status
    restarted_groups = request(base, business_path + "?current=1&pageSize=100", token=token)["data"]
    restarted_names = {group["name"] for group in restarted_groups}
    assert before_name in restarted_names
    if post_name:
        assert post_name in restarted_names, "Restart lost an accepted post-decision write"
        assert json.loads(inside("cat", root + "/data/accepted-after-decision.json"))["name"] == post_name
    if database == "mysql":
        assert mysql_sql("SELECT * FROM untouched_sibling.sentinel;") == sibling
    evidence = {"at": datetime.now(timezone.utc).isoformat(), "fixture": name,
                "database": database, "scenario": scenario, "componentScenario": components, "job": terminal,
                "decision": details["decision"], "operations": details["operations"],
                "health": health, "acceptedWritePreserved": post_name is not None,
                "businessRows": {"before": before_name, "afterDecision": post_name},
                "businessApi": business_path,
                "containers": {"before": initial_containers, "after": final_containers},
                "siblingSchemaPreserved": sibling is not None,
                "artifacts": {role: {component: {
                    "version": value["version"], "sourceCommit": value["sourceCommit"],
                    "url": value["artifact"]["url"], "sha256": value["artifact"]["sha256"],
                } for component, value in components.items()} for role, components in [
                    ("original", details["originalInstallation"]["current"]),
                    ("target", details["plan"]["targets"]),
                ]},
                "sameJobAfterServiceRestart": True, "provenance": "unpublished-local-fixtures"}
    evidence["externallyKilledAt"] = observed_faults
    evidence["externalInterruptions"] = external_interruptions
    evidence["recoveredWorker"] = {"containerId": recovered_worker["Id"],
                                   "startedAt": recovered_worker["State"]["StartedAt"],
                                   "jobId": job_id}
    if fixture_catalog:
        catalog = Path(fixture_catalog)
        evidence["artifactCatalog"] = {"file": catalog.name,
                                       "sha256": hashlib.sha256(catalog.read_bytes()).hexdigest()}
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    evidence_file = ARTIFACTS / (name + "-result.json")
    evidence_file.write_text(json.dumps(evidence, indent=2), encoding="utf8")
    print(json.dumps({"evidence": str(evidence_file), "jobId": job_id,
                      "status": terminal["status"], "decision": details["decision"],
                      "acceptedWritePreserved": post_name is not None,
                      "sameJobAfterServiceRestart": True}), flush=True)
    # Preserve data and journals; only stop this completed test's app/helper services.
    compose(name, "stop")
    return evidence


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", choices=["sqlite", "mysql"], required=True)
    parser.add_argument("--scenario", choices=list(SCENARIOS) + ["all"], default="all")
    parser.add_argument("--components", choices=["backend", "web", "both"], default="backend",
                        help="Unpublished catalog fixture only; never a product API parameter")
    parser.add_argument("--fixture-catalog", help="Separate final-runtime immutable image catalog")
    args = parser.parse_args()
    for scenario in SCENARIOS if args.scenario == "all" else [args.scenario]:
        run(args.database, scenario, args.components, args.fixture_catalog)
