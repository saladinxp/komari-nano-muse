/* Preview-only Komari fixture. Never included in the installable theme. */
;(() => {
  const now = Date.now(),
    GB = 1024 ** 3,
    TB = 1024 ** 4
  const locations = [
    ['Tokyo', 'JP', '日本'],
    ['Osaka', 'JP', '日本'],
    ['Singapore', 'SG', '亚洲'],
    ['Hong Kong', 'HK', '亚洲'],
    ['Seoul', 'KR', '亚洲'],
    ['Taipei', 'TW', '亚洲'],
    ['Los Angeles', 'US', '美洲'],
    ['San Jose', 'US', '美洲'],
    ['New York', 'US', '美洲'],
    ['Seattle', 'US', '美洲'],
    ['Frankfurt', 'DE', '欧洲'],
    ['Amsterdam', 'NL', '欧洲'],
    ['London', 'GB', '欧洲'],
    ['Paris', 'FR', '欧洲'],
    ['Sydney', 'AU', '大洋洲'],
    ['Toronto', 'CA', '美洲'],
  ]
  /* Scene demo: nodes 0, 1 (same group, so one visits the other) and 9 idle (<5% CPU all hour). */
  const IDLE = new Set([0, 1, 9])
  /* Ledger demo (2.1.0-beta.6): [price, currency, billing_cycle days, expiry in days].
     $ / ¥ / € (Komari stores what the admin typed; its default is '$'), monthly to two-year cycles, Seattle free and long-term, Toronto paid
     but long-term, Paris expired three days ago. Only Taipei 06 is within 7 days, so the
     duty-room expiry moment, patrol and the home calendar keep their single demo node. */
  const BILLING = [
    [48, '$', 365, 80],
    [15, '¥', 30, 19],
    [98, '$', 365, 102],
    [88, '¥', 92, 45],
    [38, '$', 365, 124],
    [26, '$', 365, 6],
    [98, '$', 365, 146],
    [9.99, '$', 30, 23],
    [12, '€', 92, 58],
    [-1, '$', 0, null],
    [4.5, '€', 30, 16],
    [39, '€', 365, 200],
    [120, '$', 730, 300],
    [5, '€', 30, -3],
    [60, '$', 184, 71],
    [5, '$', 30, 'zero'],
  ]
  const nodes = locations.map(([name, region, group], i) => ({
    uuid: 'demo-' + i,
    name: name + ' ' + String(i + 1).padStart(2, '0'),
    region,
    group,
    os: 'Debian GNU/Linux 12 (bookworm)',
    cpu_name: 'AMD EPYC 7B13',
    cpu_cores: [4, 2, 8, 4][i % 4],
    mem_total: [8, 4, 16, 8][i % 4] * GB,
    disk_total: [200, 80, 500, 160][i % 4] * GB,
    weight: i,
    price: BILLING[i][0],
    currency: BILLING[i][1],
    billing_cycle: BILLING[i][2],
    auto_renewal: i % 2 === 0,
    /* Komari sends null or year 0001 for "no expiry"; both appear here. */
    expired_at:
      BILLING[i][3] === null
        ? null
        : BILLING[i][3] === 'zero'
          ? '0001-01-01T00:00:00Z'
          : new Date(now + BILLING[i][3] * 864e5).toISOString(),
    traffic_limit: (i % 3 === 0 ? 3 : 0) * TB,
    traffic_limit_type: 'sum',
    virtualization: 'KVM',
    arch: 'amd64',
    tags: 'Production;NVMe',
  }))
  const live = Object.fromEntries(
    nodes.map((n, i) => [
      n.uuid,
      {
        cpu: { usage: i === 2 ? 84.6 : IDLE.has(i) ? 2.4 + i * 0.1 : 5.2 + ((i * 13) % 47) },
        ram: { total: n.mem_total, used: n.mem_total * (i === 4 ? 0.84 : 0.18 + ((i * 0.073) % 0.54)) },
        ...(i === 7 || i === 13
          ? {}
          : {
              load: {
                load1: Number((n.cpu_cores * (i === 2 ? 1.15 : IDLE.has(i) ? 0.03 : 0.24)).toFixed(2)),
                load5: Number((n.cpu_cores * (i === 2 ? 0.95 : 0.18)).toFixed(2)),
                load15: Number((n.cpu_cores * 0.15).toFixed(2)),
              },
            }),
        disk: { total: n.disk_total, used: n.disk_total * (0.13 + ((i * 0.09) % 0.55)) },
        network: {
          up: (i + 1) * 0.29 * 1024 ** 2,
          down: (i + 1) * 0.63 * 1024 ** 2,
          totalUp: (i === 12 ? 1.2 : 0.08 + i * 0.033) * TB,
          totalDown: (i === 12 ? 1.56 : 0.12 + i * 0.021) * TB,
        },
        connections: { tcp: 54 + i * 26, udp: 7 + i },
        uptime: (23 + i * 7) * 86400 + 8132,
        process: 63 + i,
        updated_at: new Date(now).toISOString(),
      },
    ]),
  )
  /* `?scenario=nows` starts with the live socket refused (a reverse proxy without upgrade /
     Host forwarding), so the theme has to fall back to polling over HTTP from the first frame. */
  let online = nodes.slice(0, 15).map(n => n.uuid),
    mode = new URLSearchParams(location.search).get('scenario') === 'nows' ? 'nows' : 'normal'
  /* built-in metric names of current Komari (internal/metricstore/metrics.go): no memory.total / disk.total */
  const METRIC_NAMES = [
    'cpu.usage',
    'gpu.usage',
    'memory.used',
    'swap.used',
    'load.average',
    'disk.used',
    'net.in.rate',
    'net.out.rate',
    'net.total.up',
    'net.total.down',
    'traffic.up',
    'traffic.down',
    'process.count',
    'connections.tcp',
    'connections.udp',
    'ping.latency_ms',
    'ping.loss',
  ]
  const adminPreview = new URLSearchParams(location.search).get('admin') === '1'
  /* `?echo=preset`: the Echo default lines are already enabled (Hebei three carriers +
     Google), so the Star Map has arcs to draw. Seattle 10 is left off those tasks to show
     a node that only gets a dot. Mock latencies only; they say nothing about reachability. */
  const echoPreset = new URLSearchParams(location.search).get('echo') === 'preset'
  const PRESET_TASKS = [
    { id: 4, key: 'telecom', name: '回声预设 · 电信 · 河北', target: '124.237.177.164' },
    { id: 5, key: 'unicom', name: '回声预设 · 联通 · 河北', target: '110.242.74.102' },
    { id: 6, key: 'mobile', name: '回声预设 · 移动 · 河北', target: '111.63.65.247' },
    { id: 7, key: 'google', name: '回声预设 · Google', target: '8.8.8.8' },
  ]
  let savedPreview = {}
  try {
    savedPreview = JSON.parse(sessionStorage.getItem('nm-preview-echo-admin') || '{}')
  } catch {}
  let themeSettings = {
    hero_subtitle: '静默观测，信号常在。',
    hero_quote: '在寂静里聆听，让每一次连接都有回响。',
    brand_sub: 'PRIVATE NODE OBSERVATORY',
    version_tag: 'v2.1.0-design.7',
    default_mode: 'light',
    ...(echoPreset
      ? {
          echo_preset_tasks: JSON.stringify(Object.fromEntries(PRESET_TASKS.map(t => [t.key, t.id]))),
          echo_preset_targets: JSON.stringify(Object.fromEntries(PRESET_TASKS.map(t => [t.key, t.target]))),
        }
      : {}),
    ...(adminPreview ? savedPreview.settings || {} : {}),
  }
  const persistPreview = () =>
    sessionStorage.setItem(
      'nm-preview-echo-admin',
      JSON.stringify({ settings: themeSettings, tasks: probeDefs }),
    )
  const probeDefs = (adminPreview && savedPreview.tasks) || [
    { id: 1, name: '北京联通' },
    { id: 2, name: '上海电信' },
    { id: 3, name: 'Cloudflare' },
    ...(echoPreset
      ? PRESET_TASKS.map(t => ({
          id: t.id,
          name: t.name,
          type: 'icmp',
          target: t.target,
          interval: 60,
          default_on: true,
          clients: nodes.filter((_, i) => i !== 9).map(n => n.uuid),
        }))
      : []),
    /* beta.7: an old Beijing task the theme created before the Hebei switch, unbound and
       still sampling (left for manual cleanup). It belongs to neither group's view. */
    ...(echoPreset
      ? [{ id: 8, name: '回声预设 · 电信 · 北京', type: 'icmp', target: '219.141.136.10', interval: 60 }]
      : []),
  ]
  /* Mock latency texture (beta.7): slow drift plus small deterministic jitter, like real
     probes. It used to be a fast sine wave, which drew regular ripples real data never shows. */
  const jitter = (i, j, task) => {
    const x = Math.sin(i * 12.9898 + j * 78.233 + task * 37.719) * 43758.5453
    return x - Math.floor(x) - 0.5
  }
  const texture = (i, j, task, amp) => Math.sin(j * 0.05 + i + task) * amp * 0.6 + jitter(i, j, task) * amp
  /* Rough round trips to Hebei by node, for the preset lines only. */
  const TO_HEBEI = [48, 52, 74, 42, 40, 50, 152, 156, 214, 158, 196, 204, 192, 188, 168, 210]
  const presetLost = (i, j, task, count) =>
    i === 15 ||
    (i === 14 && task <= 6) ||
    (i === 4 && task === 6 && j >= count - 3) ||
    (i === 2 && task === 6 && j % 7 === 0)
  const pingValue = (i, j, task, count) =>
    task >= 4 && task <= 7
      ? presetLost(i, j, task, count)
        ? null
        : task === 7
          ? 8 + i * 3 + texture(i, j, task, 2)
          : TO_HEBEI[i] +
            (task - 4) * 6 +
            texture(i, j, task, 4) +
            (i === 7 && task === 4 && j % 9 === 0 ? 95 : 0)
      : i === 15 || (i === 4 && task === 3 && j >= count - 3)
        ? null
        : 18 + i * 9 + task * 8 + texture(i, j, task, 4) + (i === 7 && task === 1 && j % 9 === 0 ? 95 : 0)
  const pingLoss = (i, j, task, count) =>
    task >= 4 && task <= 7
      ? presetLost(i, j, task, count)
        ? 1
        : 0
      : i === 15 || (i === 4 && task === 3 && j >= count - 3)
        ? 1
        : i === 2 && task === 2 && j % 7 === 0
          ? 1
          : 0
  const cpu = (i, j) =>
    IDLE.has(i)
      ? 1.6 + Math.sin(j * 0.5 + i) * 0.8
      : Math.max(
          1,
          Math.min(
            96,
            12 +
              i * 0.8 +
              Math.sin(j * 0.18 + i) * 6 +
              Math.pow(Math.max(0, Math.sin(j * 0.24 + i * 0.5)), 18) * (i === 2 ? 65 : 26),
          ),
        )
  function series(params) {
    const count = params.max_points || 96,
      hours = params.hours || 24
    return nodes
      .filter(n => !params.entity_id || n.uuid === params.entity_id)
      .flatMap(n => {
        const i = nodes.indexOf(n)
        return params.metric_keys.flatMap(k => {
          const tasks = k.startsWith('ping.')
            ? probeDefs.filter(t => !t.clients || t.clients.includes(n.uuid)).map(t => t.id)
            : [null]
          return tasks.map(task => ({
            entity_id: n.uuid,
            metric_key: k,
            tags: task ? { task_id: String(task) } : {},
            points: Array.from({ length: count }, (_, j) => ({
              time: new Date(
                now -
                  hours * 36e5 +
                  (j / (count - 1)) * hours * 36e5 -
                  (mode === 'staleping' && k.startsWith('ping.') ? 20 * 60000 : 0),
              ).toISOString(),
              value:
                k === 'cpu.usage'
                  ? cpu(i, j)
                  : k === 'memory.used'
                    ? n.mem_total * (0.4 + Math.sin(j * 0.06) * 0.08)
                    : k === 'disk.used'
                      ? n.disk_total * 0.38
                      : k === 'net.in.rate'
                        ? 1024 ** 2 * (3 + Math.sin(j * 0.13) * 2)
                        : k === 'net.out.rate'
                          ? 1024 ** 2 * (1 + Math.cos(j * 0.13) * 0.7)
                          : k === 'connections.tcp'
                            ? 80 + Math.round(Math.sin(j * 0.1) * 24)
                            : k === 'connections.udp'
                              ? 12
                              : k === 'ping.latency_ms'
                                ? pingValue(i, j, task, count)
                                : k === 'ping.loss'
                                  ? pingLoss(i, j, task, count)
                                  : 0,
            })),
          }))
        })
      })
  }
  window.previewRequests = []
  window.fetch = async (url, options = {}) => {
    const u = new URL(url, 'https://preview.invalid')
    let data = {}
    window.previewRequests.push({
      path: u.pathname,
      params: options.body ? JSON.parse(options.body).params : null,
      method: options.body ? JSON.parse(options.body).method : null,
    })
    if (u.pathname === '/api/admin/theme/settings') {
      if (!adminPreview) return new Response('Unauthorized', { status: 401 })
      themeSettings = JSON.parse(options.body)
      persistPreview()
      return Response.json({ status: 'success' })
    }
    if (u.pathname === '/api/public')
      data = {
        sitename: new URLSearchParams(location.search).get('title') || 'NanoMuse',
        theme: 'NanoMuse',
        theme_settings: themeSettings,
      }
    else if (u.pathname === '/api/nodes') data = mode === 'empty' ? [] : nodes
    else if (u.pathname === '/api/me') data = { logged_in: adminPreview }
    else if (u.pathname === '/api/rpc2') {
      const p = JSON.parse(options.body),
        method = p.method
      if (method.startsWith('admin:')) {
        if (!adminPreview) return Response.json({ error: { message: 'Unauthorized' } })
        if (method === 'admin:getAllPingTasks') return Response.json({ result: probeDefs })
        if (method === 'admin:addPingTask') {
          const id = Math.max(0, ...probeDefs.map(t => t.id)) + 1
          probeDefs.push({ ...p.params, id })
          persistPreview()
          return Response.json({ result: { task_id: id } })
        }
      }
      if (method === 'public:listMetricDefinitions')
        return Response.json({ result: mode === 'legacy' ? [] : METRIC_NAMES.map(name => ({ name })) })
      /* like Komari: one unknown key fails the whole query */
      const unknown =
        method === 'public:queryMetrics' && p.params.metric_keys.find(k => !METRIC_NAMES.includes(k))
      if (unknown) {
        window.previewRequests[window.previewRequests.length - 1].error = 'unknown metric key: ' + unknown
        return Response.json({
          jsonrpc: '2.0',
          id: p.id,
          error: { code: -32602, message: 'unknown metric key: ' + unknown },
        })
      }
      if (
        mode === 'pingerror' &&
        method === 'public:queryMetrics' &&
        p.params.metric_keys.some(k => k.startsWith('ping.'))
      )
        return new Response('Preview probe failure', { status: 503 })
      if (method === 'public:queryMetrics')
        return Response.json({
          result: {
            series:
              mode === 'nohistory' ||
              (mode === 'noprobe' && p.params.metric_keys.some(k => k.startsWith('ping.')))
                ? []
                : series(p.params),
          },
        })
      if (method === 'public:getPublicPingTasks')
        /* current Komari also lists the nodes each task runs on */
        return Response.json({
          result:
            mode === 'noprobe'
              ? []
              : probeDefs.map(t => ({
                  id: t.id,
                  name: t.name,
                  type: t.type || 'icmp',
                  interval: t.interval || 60,
                  clients: t.clients || nodes.map(n => n.uuid),
                  default_on: !!t.default_on,
                })),
        })
      if (method === 'public:getPingMetricStats') return Response.json({ result: { stats: [] } })
      /* like Komari: map uuid → flat latest report, online flag inside; rates named from the
         server's side (net_in = the node's download) and UDP counted inside connections */
      if (method === 'common:getNodesLatestStatus') {
        if (mode === 'disconnect') return new Response('Bad gateway', { status: 502 })
        const frame = mode === 'empty' ? { online: [], data: {} } : liveFrame()
        return Response.json({
          result: Object.fromEntries(
            Object.entries(frame.data).map(([uuid, r]) => [
              uuid,
              {
                client: uuid,
                time: r.updated_at,
                cpu: r.cpu.usage,
                ram: r.ram.used,
                ram_total: r.ram.total,
                swap: 0,
                swap_total: 0,
                ...(r.load ? { load: r.load.load1, load5: r.load.load5, load15: r.load.load15 } : {}),
                disk: r.disk.used,
                disk_total: r.disk.total,
                net_in: r.network.down,
                net_out: r.network.up,
                net_total_up: r.network.totalUp,
                net_total_down: r.network.totalDown,
                process: r.process,
                connections: r.connections.tcp + r.connections.udp,
                connections_udp: r.connections.udp,
                online: frame.online.includes(uuid),
                uptime: r.uptime,
                ping: {},
              },
            ]),
          ),
        })
      }
      return Response.json({ result: {} })
    } else if (u.pathname === '/api/records/load') {
      const i = Math.max(
          0,
          nodes.findIndex(n => n.uuid === u.searchParams.get('uuid')),
        ),
        hours = +(u.searchParams.get('hours') || 24)
      data = {
        records:
          mode === 'nohistory'
            ? []
            : Array.from({ length: 96 }, (_, j) => ({
                time: new Date(now - hours * 36e5 + (j / 95) * hours * 36e5).toISOString(),
                cpu: cpu(i, j),
                /* current Komari: bytes, and the totals rebuilt from the metric store are 0 */
                ram: Math.round(nodes[i].mem_total * (0.42 + Math.sin(j * 0.1) * 0.08)),
                ram_total: 0,
                disk: Math.round(nodes[i].disk_total * 0.38),
                disk_total: 0,
                net_in: 1024 ** 2 * (3 + Math.sin(j * 0.1)),
                net_out: 1024 ** 2 * (1 + Math.cos(j * 0.1) * 0.5),
                connections: 80,
                connections_udp: 12,
              })),
      }
    } else if (u.pathname === '/api/records/ping') {
      if (mode === 'pingerror') return new Response('Preview probe failure', { status: 503 })
      const i = Math.max(
          0,
          nodes.findIndex(n => n.uuid === u.searchParams.get('uuid')),
        ),
        hours = +(u.searchParams.get('hours') || 24)
      data = {
        tasks: mode === 'noprobe' ? [] : probeDefs,
        records:
          mode === 'nohistory' || mode === 'noprobe'
            ? []
            : probeDefs.flatMap(t =>
                Array.from({ length: 48 }, (_, j) => ({
                  task_id: t.id,
                  time: new Date(
                    now - hours * 36e5 + (j / 47) * hours * 36e5 - (mode === 'staleping' ? 20 * 60000 : 0),
                  ).toISOString(),
                  value: pingLoss(i, j, t.id, 48) === 1 ? -1 : pingValue(i, j, t.id, 48),
                })),
              ),
      }
    } else return new Response('Not found', { status: 404 })
    return Response.json({ data })
  }
  /* Live frames: small CPU jitter, and in the normal scenario a 4-minute loop of
     real-looking events for the duty room: Amsterdam spikes (the leader calls
     after a minute), Paris drops offline and returns, New York reboots. */
  const started = Date.now()
  function liveFrame() {
    const t = (Date.now() - started) / 1000,
      loop = t % 240,
      drama = mode === 'normal'
    const data = {}
    nodes.forEach((n, i) => {
      const r = live[n.uuid],
        base = r.cpu.usage,
        wave = IDLE.has(i) ? Math.sin(t / 7 + i) * 0.6 : Math.sin(t / 9 + i) * 2.5
      let usage = Math.max(0.5, base + wave),
        uptime = r.uptime + t
      if (drama && i === 11 && loop >= 20 && loop < 110) usage = 91 + Math.sin(t) * 3
      if (drama && i === 8 && t >= 60) uptime = t - 55
      data[n.uuid] = { ...r, cpu: { usage }, uptime, updated_at: new Date().toISOString() }
    })
    const away = drama && loop >= 40 && loop < 70 ? nodes[13].uuid : null
    return { online: online.filter(id => id !== away), data }
  }
  class DemoSocket {
    constructor() {
      this.readyState = 0
      window.previewSocket = this
      setTimeout(() => {
        /* refused upgrade: the socket closes without ever opening */
        if (mode === 'nows') return this.close()
        this.readyState = 1
        this.onopen?.()
      }, 40)
    }
    send() {
      setTimeout(() => {
        if (this.readyState !== 1) return
        const frame = mode === 'empty' ? { online: [], data: {} } : liveFrame()
        this.onmessage?.({ data: JSON.stringify({ data: frame }) })
      }, 20)
    }
    close() {
      this.readyState = 3
      this.onclose?.()
    }
  }
  window.WebSocket = DemoSocket
  window.previewScenario = async function (value) {
    /* the polling fallback only starts after a socket fails to open, so reload into or out of it;
       the preset lines are theme settings read at start, so they reload too */
    if (value === 'nows' || mode === 'nows' || value === 'preset' || echoPreset) {
      location.search = value === 'nows' ? '?scenario=nows' : value === 'preset' ? '?echo=preset' : ''
      return
    }
    mode = value
    online =
      value === 'allonline'
        ? nodes.map(n => n.uuid)
        : value === 'alloffline'
          ? []
          : nodes.slice(0, 15).map(n => n.uuid)
    if (value === 'disconnect') {
      window.previewSocket.close()
      return
    }
    const app = window.__NM_APP__
    if (window.NM && app) {
      if (value !== 'disconnect' && window.previewSocket.readyState !== 1) {
        window.previewSocket.readyState = 1
        app.setLive(true)
      }
      window.NM.status = 'all'
      window.NM.q = ''
      document.getElementById('statusFilter').value = 'all'
      document.getElementById('search').value = ''
      await app.loadNodes()
      app.resetEcho()
      app.resetMetricStore()
      window.NM.fleetCpu = null
      window.NM.fleetAvg = null
      app.applySettings()
      app.route()
      window.previewSocket.send()
      await app.loadFleet()
    }
  }
  window.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div')
    banner.className = 'demo-banner'
    banner.innerHTML =
      '<span><i></i> 设计预览 · 模拟 16 台节点</span><span><select id="previewScenario" aria-label="预览场景"><option value="normal">常规场景</option><option value="allonline">全部在线</option><option value="alloffline">全部离线</option><option value="empty">空节点</option><option value="nohistory">无历史数据</option><option value="legacy">旧接口</option><option value="noprobe">未配置拨测</option><option value="pingerror">拨测接口失败</option><option value="staleping">拨测旧样本</option><option value="disconnect">断开连接</option><option value="nows">WebSocket 被拦（轮询）</option><option value="preset">默认四线已启用（星图弧线）</option></select> 不连接真实服务器</span>'
    document.body.prepend(banner)
    document.getElementById('previewScenario').value = echoPreset ? 'preset' : mode
    document.getElementById('previewScenario').onchange = e => window.previewScenario(e.target.value)
  })
})()
