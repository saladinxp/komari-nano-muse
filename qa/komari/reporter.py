"""Scripted Komari v2 agents for the NanoMuse acceptance run.

Each client reports through the real agent protocol (POST /api/clients/v2/rpc?token=...)
with a fixed load profile, so the server stores real records, metrics and ping results.
Usage: python3 qa/komari/reporter.py http://127.0.0.1:25774 <state>/scripted.json
clients.json: [{"uuid", "token", "profile", "days"}]
"""
import json
import math
import random
import sys
import threading
import time
from urllib.parse import quote
from urllib.request import Request, urlopen

SERVER = sys.argv[1].rstrip("/")
CLIENTS = json.load(open(sys.argv[2]))
GB = 1024**3
START = time.time()


def rpc(token, method, params, rid):
    body = json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": rid}).encode()
    req = Request(f"{SERVER}/api/clients/v2/rpc?token={quote(token, safe='')}", data=body,
                  headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=40) as r:
        out = json.loads(r.read())
    if out.get("error"):
        raise RuntimeError(out["error"])
    return out.get("result") or {}


def cpu_for(profile, t):
    if profile == "idle":
        return 1.5 + random.random() * 1.5
    if profile == "busy":
        return 86 + random.random() * 6
    if profile == "spike":  # 70 s at ~90 % every 4 minutes
        return 88 + random.random() * 4 if (t % 240) < 70 else 18 + random.random() * 8
    return 24 + 10 * math.sin(t / 60) + random.random() * 4


def report(c, t):
    p = c["profile"]
    mem_total, disk_total = 8 * GB, 100 * GB
    ram = 0.84 if p == "highram" else 0.42
    traffic = 46 * GB if p == "traffic" else 2 * GB
    return {
        "cpu": {"name": "Scripted CPU", "cores": 4, "arch": "amd64", "usage": round(cpu_for(p, t), 2)},
        "ram": {"total": mem_total, "used": int(mem_total * (ram + random.random() * 0.02))},
        "swap": {"total": 0, "used": 0},
        "load": {"load1": 0.4, "load5": 0.3, "load15": 0.2},
        "disk": {"total": disk_total, "used": int(disk_total * 0.38)},
        "network": {"up": random.randint(20_000, 400_000), "down": random.randint(50_000, 900_000),
                    "totalUp": traffic + int(t * 1000), "totalDown": traffic + int(t * 3000)},
        "connections": {"tcp": random.randint(40, 90), "udp": random.randint(2, 12)},
        "uptime": int(c.get("days", 3) * 86400 + t),
        "process": random.randint(60, 120),
        "message": "",
    }


def pull_loop(c, acks):
    while True:
        try:
            res = rpc(c["token"], "agent.pull", {"capabilities": ["ping"], "ack_event_ids": acks[:]}, f"pull-{time.time_ns()}")
            acks.clear()
            for ev in res.get("events", []):
                if ev.get("method") != "agent.ping":
                    continue
                prm = ev.get("params") or {}
                lossy = c["profile"] == "highram" and random.random() < 0.3
                rpc(c["token"], "agent.pingResult", {
                    "task_id": prm.get("ping_task_id"), "ping_type": prm.get("ping_type", "tcp"),
                    "value": -1 if lossy else random.randint(18, 60) + 40 * (c["profile"] == "traffic"),
                    "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }, f"ping-{time.time_ns()}")
                if ev.get("id"):
                    acks.append(ev["id"])
        except Exception as e:  # keep going; the server may restart
            print(c["profile"], "pull", e, flush=True)
            time.sleep(3)


def run(c):
    info = {"cpu_name": "Scripted CPU", "cpu_cores": 4, "arch": "amd64", "os": "Debian GNU/Linux 12 (bookworm)",
            "kernel_version": "6.1.0", "mem_total": 8 * GB, "swap_total": 0, "disk_total": 100 * GB,
            "virtualization": "kvm", "version": "scripted/1.0", "ipv4": "", "ipv6": "", "gpu_name": ""}
    rpc(c["token"], "agent.basicInfo", {"info": info}, "basic")
    acks = []
    threading.Thread(target=pull_loop, args=(c, acks), daemon=True).start()
    while True:
        try:
            rpc(c["token"], "agent.report", {"report": report(c, time.time() - START), "ack_event_ids": []}, f"r-{time.time_ns()}")
        except Exception as e:
            print(c["profile"], "report", e, flush=True)
        time.sleep(3)


for c in CLIENTS:
    threading.Thread(target=run, args=(c,), daemon=True).start()
print("reporting", [c["profile"] for c in CLIENTS], flush=True)
while True:
    time.sleep(60)
