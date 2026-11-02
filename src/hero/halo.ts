import { getJson, hasMetricStore, pmap, queryMetrics } from '../api/client'
import { rSummary } from './summary'
import { S, thr, visible } from '../state'
import { $, esc } from '../utils/format'
import { metrics } from '../utils/metrics'

/* Signal halo — absolute 0–100% CPU, so a quiet fleet reads as a quiet ring.
   The static layer is built once so the slow rotation never restarts. */
const HC = 300
const hpol = (r, a) => [(HC + r * Math.cos(a)).toFixed(1), (HC + r * Math.sin(a)).toFixed(1)]
function orbitInit() {
  const s = $('haloSvg')
  if (!s) return
  s.innerHTML = `<circle class="h-ring" cx="300" cy="300" r="150"/>
  <g id="hArc"></g><g id="hTicks"></g>
  <g class="h-spin"><circle class="h-dash" cx="300" cy="300" r="204"/><circle class="h-sat" cx="300" cy="96" r="3"/></g>
  <circle class="h-ring" cx="300" cy="300" r="216" opacity=".8"/>
  <g id="hWave" class="h-wave"></g>
  <g class="h-spin rev"><circle class="h-dash" cx="300" cy="300" r="290"/><circle class="h-sat" cx="300" cy="10" r="2.5" opacity=".8"/></g>
`
  rOrbit()
}
function rOrbit() {
  if (!$('hWave')) return
  const data = S.fleetCpu,
    valid = data ? data.filter(v => v != null && Number.isFinite(v)) : []
  /* 96 radial bars from 12 o'clock clockwise, oldest → newest */
  let w = ''
  if (data && valid.length) {
    const n = data.length,
      hi = thr('cpu')
    data.forEach((v, i) => {
      const ang = -Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2,
        ok = v != null && Number.isFinite(v)
      const f = ok ? Math.sqrt(Math.max(0, Math.min(100, v)) / 100) : 0,
        len = ok ? 4 + f * 54 : 2
      const [x1, y1] = hpol(224, ang),
        [x2, y2] = hpol(224 + len, ang)
      const col = !ok
        ? 'var(--line)'
        : v >= hi
          ? 'var(--coral)'
          : v >= hi * 0.75
            ? 'var(--amber)'
            : 'url(#gBlue)'
      w += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" opacity="${ok ? (0.45 + f * 0.55).toFixed(2) : 1}"/>`
    })
    $('historyScope').textContent =
      'CPU / 24H · ' + (S.fleetSource === 'sample' ? '抽样 ' + S.fleetSample + ' 台' : '可见节点')
    $('fleetPeak').textContent = 'PEAK ' + Math.max(...valid).toFixed(1) + '%'
    $('telemetry').setAttribute(
      'aria-label',
      '信号光环：过去24小时' +
        (S.fleetSource === 'sample' ? '抽样' + S.fleetSample + '台' : '可见节点') +
        ' CPU 平均负载，峰值 ' +
        Math.max(...valid).toFixed(1) +
        '%',
    )
  } else {
    for (let i = 0; i < 96; i++) {
      const ang = -Math.PI / 2 + ((i + 0.5) / 96) * Math.PI * 2,
        [x1, y1] = hpol(224, ang),
        [x2, y2] = hpol(226, ang)
      w += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--line)"/>`
    }
    $('historyScope').textContent = 'CPU / 24H'
    $('fleetPeak').textContent = S._historyDone ? '暂无历史数据' : '等待历史数据'
  }
  $('hWave').innerHTML = w
  /* one tick per visible node, sweeping 270° from lower-left */
  const vis = visible(),
    ready = !!S.lastSync
  let t = ''
  const N = vis.length,
    span = Math.PI * 1.5,
    start = Math.PI * 0.75
  vis.forEach((nd, i) => {
    const ang = start + (N === 1 ? span / 2 : (i / (N - 1)) * span),
      on = S.online.has(nd.uuid)
    const [x1, y1] = hpol(176, ang),
      [x2, y2] = hpol(192, ang)
    t += `<line class="h-tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${!ready ? 'var(--ink4)' : on ? 'var(--cyan)' : 'var(--coral)'}"><title>${esc(nd.name)}</title></line>`
  })
  $('hTicks').innerHTML = t
  /* live mean CPU of online nodes as an arc */
  const on = vis.filter(nd => S.online.has(nd.uuid)),
    cpu = on.length ? on.reduce((s, nd) => s + metrics(nd).cpu, 0) / on.length : null
  const C = 2 * Math.PI * 164,
    f = cpu == null ? 0 : Math.min(1, cpu / 100)
  $('hArc').innerHTML =
    `<circle class="h-arc" cx="300" cy="300" r="164" stroke="var(--line2)"/><circle class="h-arc" cx="300" cy="300" r="164" stroke="${cpu != null && cpu >= thr('cpu') ? 'var(--coral)' : 'url(#gBlue)'}" stroke-dasharray="${(C * f).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 300 300)"/>`
  $('keyNodes').textContent = ready ? on.length + ' / ' + N + ' 在线' : '等待连接'
  $('keyLive').textContent = '实时 CPU ' + (ready && cpu != null ? cpu.toFixed(1) + '%' : '—')
}
/* fleet CPU sparkline (24h) */
async function loadFleet() {
  const vis = visible()
  if (!vis.length) {
    S.fleetCpu = null
    S.fleetAvg = null
    S._historyDone = true
    rSpark()
    rSummary()
    return
  }
  const B = 96,
    now = Date.now(),
    span = 864e5
  let series = null
  S.fleetSource = 'all'
  if (await hasMetricStore()) {
    try {
      const ss = await queryMetrics(['cpu.usage'], { hours: 24, max: B })
      const ids = new Set(vis.map(n => n.uuid)),
        sum = new Array(B).fill(0),
        cnt = new Array(B).fill(0)
      ss.forEach(s => {
        if (!ids.has(s.entity_id)) return
        const sums = new Array(B).fill(0),
          counts = new Array(B).fill(0)
        for (const p of s.points || []) {
          const age = +new Date(p.time) - (now - span),
            i = Math.min(B - 1, Math.floor((age / span) * B))
          if (age >= 0 && age <= span && i >= 0 && Number.isFinite(p.value)) {
            sums[i] += p.value
            counts[i]++
          }
        }
        for (let i = 0; i < B; i++)
          if (counts[i]) {
            sum[i] += sums[i] / counts[i]
            cnt[i]++
          }
      })
      if (cnt.some(c => c)) series = sum.map((v, i) => (cnt[i] ? v / cnt[i] : null))
    } catch (e) {}
  }
  if (!series) {
    const pick = vis.filter(n => S.online.has(n.uuid)).slice(0, 8)
    const use = pick.length ? pick : vis.slice(0, 8)
    const sum = new Array(B).fill(0),
      cnt = new Array(B).fill(0)
    S.fleetSource = use.length < vis.length ? 'sample' : 'all'
    S.fleetSample = use.length
    await pmap(
      use,
      async n => {
        const d = await getJson('/api/records/load?uuid=' + encodeURIComponent(n.uuid) + '&hours=24')
        ;(d.records || []).forEach(r => {
          const i = Math.floor(((+new Date(r.time) - (now - span)) / span) * B)
          if (i >= 0 && i < B && r.cpu != null) {
            sum[i] += r.cpu
            cnt[i]++
          }
        })
      },
      3,
    )
    if (cnt.some(c => c)) series = sum.map((v, i) => (cnt[i] ? v / cnt[i] : null))
  }
  S._historyDone = true
  if (!series) {
    S.fleetCpu = null
    S.fleetAvg = null
    rSpark()
    rSummary()
    return
  }
  S.fleetCpu = series
  const vals = series.filter(v => v != null)
  S.fleetAvg = vals.reduce((a, b) => a + b, 0) / vals.length
  rSpark()
  rSummary()
}
function rSpark() {
  rOrbit()
}

export { loadFleet, orbitInit, rOrbit, rSpark }
