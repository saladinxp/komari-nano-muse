"""Reproducible local candidate installation + acceptance. Never use a production data directory.
python3 qa/komari/run-next.py <komari binary> <agent binary> <new state directory> <Playwright preload>
Credentials and node tokens stay only inside the supplied private scratch directory.
"""
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import sqlite3
import subprocess
import sys
import time
import urllib.request

repo = Path.cwd()
version = json.loads((repo / 'komari-theme.json').read_text())['version']
server_bin, agent_bin, state, preload = map(lambda p: Path(p).resolve(), sys.argv[1:])
state.mkdir(mode=0o700, parents=True, exist_ok=False)
run = state / 'run'
run.mkdir()
base = 'http://127.0.0.1:25774'
env = {**os.environ, 'NM_OFFLINE_FONTS': '1',
       'HTTP_PROXY': 'http://127.0.0.1:1', 'HTTPS_PROXY': 'http://127.0.0.1:1',
       'http_proxy': 'http://127.0.0.1:1', 'https_proxy': 'http://127.0.0.1:1',
       'NO_PROXY': '127.0.0.1,localhost,::1', 'no_proxy': '127.0.0.1,localhost,::1'}
processes, logs = [], []

# Configure the new, disposable instance before its first start. GeoIP and login
# notifications are unrelated to theme acceptance and may call external IP services.
# Use Komari's own config keys; do not patch the server binary. Outbound HTTP is
# additionally sent to a closed loopback port, while local API traffic stays direct.
data_dir = run / 'data'
data_dir.mkdir()
with sqlite3.connect(data_dir / 'komari.db') as db:
    db.execute('CREATE TABLE configs (key TEXT PRIMARY KEY, value TEXT)')
    db.executemany('INSERT INTO configs (key, value) VALUES (?, ?)', [
        ('geo_ip_enabled', 'false'), ('geo_ip_provider', '"empty"'),
        ('login_notification', 'false'), ('notification_enabled', 'false'),
    ])

def start(args, name, **kwargs):
    log = open(state / (name + '.log'), 'w')
    logs.append(log)
    proc = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT, **kwargs)
    processes.append(proc)
    return proc

def command(args, **kwargs):
    return subprocess.run(args, env=env, check=True, **kwargs)

try:
    start([str(server_bin), 'server'], 'server', cwd=run,
          env={**env, 'KOMARI_LISTEN': '127.0.0.1:25774'})
    for _ in range(100):
        try:
            urllib.request.urlopen(base + '/api/version', timeout=1)
            break
        except Exception:
            time.sleep(0.1)
    admin = {'username': 'nm_local_qa', 'password': 'Aa9' + secrets.token_hex(18)}
    (state / 'admin.json').write_text(json.dumps(admin))
    (state / 'admin.json').chmod(0o600)
    jar = http.cookiejar.MozillaCookieJar(str(state / 'cookies.txt'))
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    def send(path, data):
        req = urllib.request.Request(base + path, json.dumps(data).encode(),
                                     {'Content-Type': 'application/json'})
        return json.loads(opener.open(req, timeout=20).read())
    result = send('/api/install/complete', {**admin, 'sitename': 'NanoMuse QA ' + version,
                  'description': 'Local acceptance only', 'metric_dsn': 'file:metrics.db'})
    assert result.get('status') == 'success', result
    # The guide returns before the normal application routes are mounted.
    for _ in range(120):
        try:
            urllib.request.urlopen(base + '/api/version', timeout=1)
            break
        except Exception:
            time.sleep(0.1)
    else:
        raise RuntimeError('Normal Komari routes did not start after installation')
    result = send('/api/login', admin)
    assert result.get('status') == 'success', result
    jar.save(ignore_discard=True)
    (state / 'cookies.txt').chmod(0o600)
    # Node identifiers are local and public; credentials are never printed.
    command(['python3', 'qa/komari/nodes.py', str(state)])
    command(['bash', 'qa/komari/upload-theme.sh', f'release/nanomuse-{version}.zip', str(state)])
    clients = json.loads((state / 'clients.json').read_text())
    real = next(c for c in clients if c['profile'] == 'real')
    interval_seconds = int(env.get('NM_ECHO_INTERVAL_SECONDS', '0'))
    if interval_seconds:
        assert interval_seconds >= 660, 'Cadence acceptance needs more than ten minutes'
        interval_tasks = []
        for cadence in (60, 300):
            task = send('/api/rpc2', {'jsonrpc':'2.0','id':1,'method':'admin:addPingTask','params':{
                'name':'Local TCP ' + str(cadence) + 's beta5', 'target':'127.0.0.1:25774',
                'type':'tcp', 'interval':cadence, 'clients':[real['uuid']], 'default_on':False}})
            interval_tasks.append({'id':task['result']['task_id'],'interval':cadence})
        (state / 'interval-tasks.json').write_text(json.dumps(interval_tasks))
    agent = start([str(agent_bin), '-e', base, '-t', real['token'],
                  '--disable-auto-update', '--disable-web-ssh', '--custom-ipv4', '127.0.0.1', '--custom-ipv6', '::1'], 'agent', env=env)
    start(['python3', 'qa/komari/reporter.py', base, str(state / 'scripted.json')], 'reporter', env=env)
    for _ in range(180):
        latest = send('/api/rpc2', {'jsonrpc':'2.0', 'id':1, 'method':'common:getNodesLatestStatus', 'params':{}})
        if latest.get('result', {}).get(real['uuid'], {}).get('online'):
            print('Real agent online before acceptance', flush=True)
            break
        time.sleep(0.5)
    else:
        raise RuntimeError('Real agent did not begin reporting')
    sampling_started = time.monotonic()
    result = command(['node', '-r', str(preload), 'qa/komari/accept.mjs', base,
                      str(state / 'clients.json'), 'qa/shots'],
                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=240)
    print(result.stdout, flush=True)
    assert 'problems: none' in result.stdout
    assert '实时连接' in result.stdout
    assert 'duty roster                  7' in result.stdout
    assert 'phone overflow px            0' in result.stdout
    command(['node', '-r', str(preload), 'qa/komari/check-stellar.mjs', base, str(state / 'clients.json')], timeout=90)
    if interval_seconds:
        announced = -1
        while time.monotonic() - sampling_started < interval_seconds:
            elapsed = int(time.monotonic() - sampling_started)
            if elapsed // 60 != announced:
                print(f'Local-only TCP sampling: {elapsed}/{interval_seconds} seconds', flush=True)
                announced = elapsed // 60
            time.sleep(max(0, min(10, interval_seconds - (time.monotonic() - sampling_started))))
        command(['node', '-r', str(preload), 'qa/komari/check-echo-intervals.mjs', base, str(state)], timeout=120)
    # Stop the real agent before adding public reference targets. Scheduling/UI is tested
    # against Komari; external ICMP reachability is deliberately not an acceptance claim.
    agent.terminate()
    agent.wait(timeout=5)
    defaults_args = ['node', '-r', str(preload), 'qa/komari/check-defaults.mjs', base, str(state)]
    if env.get('NM_BETA3_UPGRADE_ZIP'):
        defaults_args.append(env['NM_BETA3_UPGRADE_ZIP'])
    command(defaults_args, timeout=240)
    # beta.6: let the scripted nodes answer the new default-line tasks (simulated results),
    # then check the Star Map and Ledger as a guest. Opt-in: NM_MAP_LEDGER_WAIT=<seconds>.
    map_wait = int(env.get('NM_MAP_LEDGER_WAIT', '0'))
    if map_wait:
        print(f'Waiting {map_wait} s for default-line samples from scripted nodes', flush=True)
        time.sleep(map_wait)
        command(['node', '-r', str(preload), 'qa/komari/check-map-ledger.mjs', base, str(state)], timeout=180)
    if env.get('NM_ECHO_SPLIT_CHECK'):
        command(['node', '-r', str(preload), 'qa/komari/check-echo-split.mjs', base, str(state)], timeout=120)
    print('Local installed ' + version + ' acceptance: PASS', flush=True)
finally:
    for proc in reversed(processes):
        proc.terminate()
    for proc in reversed(processes):
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    for log in logs:
        log.close()
