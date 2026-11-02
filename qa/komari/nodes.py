"""Create the acceptance nodes on a local Komari and write <state>/clients.json.

Usage: python3 qa/komari/nodes.py <state dir> [base url]
Needs <state dir>/cookies.txt from POST /api/login. Profiles are read by reporter.py;
'real' is left for komari-agent, 'offline' never connects.
"""
import datetime
import json
import subprocess
import sys

STATE = sys.argv[1]
BASE = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:25774"
GB = 1024**3


def call(path, body):
    out = subprocess.check_output(["curl", "-sS", "-b", f"{STATE}/cookies.txt", "-X", "POST", BASE + path,
                                   "-H", "Content-Type: application/json", "-d", json.dumps(body)])
    return json.loads(out)


def iso(days):
    t = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=days)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


NODES = [
    # name, group, region, profile, extra
    ("Tokyo 01", "日本", "🇯🇵", "real", {}),
    ("Osaka 02", "日本", "🇯🇵", "idle", {"days": 40}),
    ("Singapore 03", "亚洲", "🇸🇬", "busy", {"days": 12}),
    ("Seoul 05", "亚洲", "🇰🇷", "highram", {"days": 8, "expired_at": iso(5), "price": 5, "billing_cycle": 30, "currency": "$"}),
    ("London 13", "欧洲", "🇬🇧", "traffic", {"days": 130, "traffic_limit": 100 * GB, "traffic_limit_type": "sum"}),
    ("Amsterdam 12", "欧洲", "🇳🇱", "spike", {"days": 101}),
    ("Toronto 16", "美洲", "🇨🇦", "offline", {}),
]

clients = []
for i, (name, group, region, profile, extra) in enumerate(NODES):
    r = call("/api/admin/client/add", {"name": name})
    edit = {"uuid": r["uuid"], "name": name, "group": group, "region": region, "weight": i,
            "expired_at": extra.get("expired_at", iso(200))}
    for k in ("price", "billing_cycle", "currency", "traffic_limit", "traffic_limit_type"):
        if k in extra:
            edit[k] = extra[k]
    print(name, r["uuid"], call(f"/api/admin/client/{r['uuid']}/edit", edit).get("status"))
    clients.append({"name": name, "uuid": r["uuid"], "token": r["token"], "profile": profile, "days": extra.get("days", 3)})

json.dump(clients, open(f"{STATE}/clients.json", "w"), ensure_ascii=False, indent=1)
json.dump([c for c in clients if c["profile"] not in ("real", "offline")], open(f"{STATE}/scripted.json", "w"))
uuids = [c["uuid"] for c in clients]
for task in ({"name": "本机 TCP", "type": "tcp", "target": "127.0.0.1:25774"},
             {"name": "本机 HTTP", "type": "http", "target": BASE + "/ping"}):
    print(task["name"], call("/api/admin/ping/add", {**task, "interval": 10, "clients": uuids}).get("status"))
