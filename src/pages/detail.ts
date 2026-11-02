import { getJson, hasMetricStore, pingTasks, queryMetrics, rpc2 } from '../api/client'
import { chart } from '../charts/chart'
import { lvl } from '../nodes/list'
import {
  ECHO_PRESETS,
  customTasks,
  hasCustomTasks,
  presetBindings,
  presetRows,
  setEchoTaskDefs,
} from '../nodes/echo-presets'
import { billing } from './billing'
import { openHome, uHome } from './home'
import { nodeBy } from '../router'
import { S } from '../state'
import type { PingTaskDef } from '../types/komari'
import {
  $,
  css,
  daysLeft,
  esc,
  fB,
  fClock,
  fDate,
  fK,
  fMs,
  fS,
  fUp,
  isCJK,
  osShort,
  regionCode,
  validDate,
} from '../utils/format'
import { metrics, trafficUsed } from '../utils/metrics'
import { detailTraffic } from '../utils/usage'

/* ══ detail ══ */
/** Selectable history windows: [hours, label]. */
const HOURS: [number, string][] = [
  [1, '1H'],
  [6, '6H'],
  [24, '24H'],
  [72, '3D'],
  [168, '7D'],
  [720, '30D'],
]
function openDetail() {
  const n = nodeBy(S.det.uuid)
  if (!n) {
    $('detName').textContent = S.nodes.length ? '未找到节点' : '载入中…'
    $('detGauges').innerHTML = ''
    $('detSpec').innerHTML = ''
    $('detCharts').innerHTML = ''
    return
  }
  const h = $('detName')
  h.textContent = n.name
  h.classList.toggle('cjk', isCJK(n.name) && !/[A-Za-z]{3}/.test(n.name))
  $('detSub').textContent = [n.group, regionCode(n.region), '节点详情'].filter(Boolean).join(' · ')
  const meta = [
    ['OS', osShort(n.os)],
    ['CPU', n.cpu_name ? n.cpu_name + (n.cpu_cores ? ' × ' + n.cpu_cores : '') : ''],
    ['ARCH', n.arch],
    ['VIRT', n.virtualization],
    ['KERNEL', n.kernel_version],
    ['GPU', n.gpu_name],
  ].filter(x => x[1])
  $('detMeta').innerHTML = meta.map(([k, v]) => `<span>${k} <b>${esc(v)}</b></span>`).join('')
  openHome(n.uuid)
  uDetail()
  rDetCharts()
}
function uDetail() {
  const n = nodeBy(S.det.uuid)
  if (!n) return
  uHome()
  const on = S.online.has(n.uuid),
    m = metrics(n)
  $('detTraffic').innerHTML = detailTraffic(n)
  const C = 2 * Math.PI * 40
  const gz = (k, label, v, sub) =>
    `<div class="card"><div class="gz"><svg viewBox="0 0 88 88"><circle class="tr" cx="44" cy="44" r="40"/><circle class="fg ${on ? lvl(v, k) : ''}" cx="44" cy="44" r="40" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - (on ? Math.min(100, v) : 0) / 100)).toFixed(1)}"/></svg><b>${on ? (v < 10 ? v.toFixed(1) : Math.round(v)) + '<small>%</small>' : '--'}</b></div><div style="min-width:0"><div class="k">${label}</div><div class="s">${sub}</div></div></div>`
  $('detGauges').innerHTML =
    gz('cpu', '处理器', m.cpu, `${n.cpu_cores || '-'} CORES<br>LOAD ${m.load1.toFixed(2)}`) +
    gz('ram', '内存', m.ram, `${fB(m.memU)}<br>/ ${fB(m.memT)}`) +
    gz('disk', '磁盘', m.disk, `${fB(m.diskU)}<br>/ ${fB(m.diskT)}`) +
    `<div class="card" style="display:block"><div class="k">网络</div><div class="netv" style="margin-top:10px"><em style="color:var(--blue)">↑</em>${on ? fS(m.up) : '--'}</div><div class="netv"><em style="color:var(--cyan)">↓</em>${on ? fS(m.down) : '--'}</div><div class="s">${on ? `TCP ${m.tcp} · UDP ${m.udp}` : 'OFFLINE · 离线'}</div></div>`
  const dl = daysLeft(n.expired_at),
    bill = billing(n)
  const rows = [
    [
      '状态',
      on
        ? '<span style="color:var(--cyan)">ONLINE</span>'
        : '<span style="color:var(--coral)">OFFLINE</span>',
    ],
    ['运行时长', on ? fUp(m.uptime) : '--'],
    ['负载', on ? `${m.load1.toFixed(2)} / ${m.load5.toFixed(2)} / ${m.load15.toFixed(2)}` : '--'],
    ['连接', on ? `TCP ${m.tcp} · UDP ${m.udp}` : '--'],
    ['进程', on ? m.proc : '--'],
    ['交换', m.swapT ? `${fB(m.swapU)} / ${fB(m.swapT)}` : '--'],
    ...(bill.str ? [['价格', esc(bill.str)]] : []),
    ...(dl != null
      ? [['到期', `${fDate(validDate(n.expired_at))} · ${dl < 0 ? '已过期' : dl + ' 天'}`]]
      : []),
    ['上报', m.at ? fClock(new Date(m.at)) : '--'],
  ]
  $('detSpec').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')
}
function rDetHours() {
  const lim = S.det.tab === 'ping' ? S.pingHours : S.recordHours
  const hs = HOURS.filter(h => h[0] <= Math.max(lim, 1))
  if (!hs.some(h => h[0] === S.det.hours)) S.det.hours = hs[Math.min(1, hs.length - 1)][0]
  $('detHours').innerHTML = hs
    .map(h => `<button data-h="${h[0]}" class="${h[0] === S.det.hours ? 'on' : ''}">${h[1]}</button>`)
    .join('')
  document
    .querySelectorAll<HTMLElement>('#detTabs button')
    .forEach(b => b.classList.toggle('on', b.dataset.t === S.det.tab))
  $('detChartT').textContent = S.det.tab === 'ping' ? 'Latency' : 'History'
  $('detChartE').textContent = S.det.tab === 'ping' ? '延迟曲线' : '负载曲线'
}
type PingStat = {
  id: number
  name: string
  pts: [number, number | null][]
  avg?: number
  p99?: number
  max?: number
  loss?: number
}
type PingLine = { name: string; title: string; color: string; task?: PingStat; message?: string }
/* The same split as the Echo view (user, 2026-11-02): 默认四线 holds only the four default
   lines in their fixed order and colours; 自定义目标 holds only the other tasks, filtered by
   the Echo target picker. The detail page shows both groups at once, each in its own box
   with its own scale (user: 「不是说分开吗，怎么又合成一个框了」), so it no longer follows or
   changes the Echo view's group choice. */
function pingLines(
  tasks: PingStat[],
  uuid: string,
  group: 'preset' | 'custom',
): { lines: PingLine[]; empty?: string } {
  if (group === 'preset') {
    const bound = presetBindings()
    if (!ECHO_PRESETS.some(p => bound[p.key]))
      return { lines: [], empty: '尚未启用默认四线 · 由管理员在总览「回声」里启用' }
    return {
      lines: presetRows(
        tasks.filter(t => t.pts.length),
        uuid,
      ).map((r, i) => ({
        name: r.name,
        title: (r.task as { fullName?: string })?.fullName || r.name,
        color: PAL[i % PAL.length],
        task: r.task,
        message: r.task ? undefined : r.message,
      })),
    }
  }
  const custom = customTasks(tasks)
  if (!custom.length)
    return {
      lines: [],
      empty: hasCustomTasks(tasks)
        ? '未选择自定义目标 · 可在总览「回声」的「选择目标」里调整'
        : '还没有自定义目标 · 管理员可在 Komari 后台新建拨测任务',
    }
  return {
    lines: custom.map((t, i) => ({
      name: t.name,
      title: t.name,
      color: PAL[i % PAL.length],
      task: t.pts.length ? t : undefined,
      message: t.pts.length ? undefined : '等待采样',
    })),
  }
}
const pctF = v => v.toFixed(v < 10 ? 1 : 0) + '%'
function cc(id: string, title: string, en: string, wide = false) {
  return `<div class="cc card${wide ? ' wide' : ''}"><div class="cc-h"><h3>${title}</h3><span class="en">${en}</span><span class="now" id="${id}N"></span></div><div class="lg" id="${id}L"></div><div class="cv" id="${id}"><div class="loading">LOADING · 载入中</div></div></div>`
}
async function rDetCharts() {
  rDetHours()
  const uuid = S.det.uuid,
    hours = S.det.hours,
    tab = S.det.tab,
    tok = (S._detTok = Math.random())
  const box = $('detCharts')
  if (tab === 'load') {
    box.innerHTML =
      cc('chCpu', '处理器', 'CPU %') +
      cc('chRam', '内存', 'MEMORY %') +
      cc('chDisk', '磁盘', 'DISK %') +
      cc('chConn', '连接', 'TCP / UDP') +
      cc('chNet', '网络', 'THROUGHPUT', true)
    const d = await fetchLoad(uuid, hours)
    if (tok !== S._detTok) return
    const last = a => {
      for (let i = a.length - 1; i >= 0; i--) if (a[i][1] != null) return a[i][1]
      return null
    }
    chart($('chCpu'), { series: [{ name: 'CPU', color: 'blue', pts: d.cpu }], max: 100, fmt: pctF })
    chart($('chRam'), { series: [{ name: 'RAM', color: 'cyan', pts: d.ram }], max: 100, fmt: pctF })
    chart($('chDisk'), { series: [{ name: 'DISK', color: 'amber', pts: d.disk }], max: 100, fmt: pctF })
    chart($('chConn'), {
      series: [
        { name: 'TCP', color: 'blue', pts: d.tcp },
        { name: 'UDP', color: 'coral', pts: d.udp, fill: false },
      ],
      fmt: v => String(Math.round(v)),
    })
    chart($('chNet'), {
      series: [
        { name: '↓ IN', color: 'blue', pts: d.netIn },
        { name: '↑ OUT', color: 'coral', pts: d.netOut },
      ],
      fmt: (v, ax) => (ax ? fK(v) : fS(v)),
    })
    const set = (id, v) => {
      $(id + 'N').textContent = v
    }
    set('chCpu', last(d.cpu) != null ? pctF(last(d.cpu)) : '')
    set('chRam', last(d.ram) != null ? pctF(last(d.ram)) : '')
    set('chDisk', last(d.disk) != null ? pctF(last(d.disk)) : '')
    $('chConnL').innerHTML =
      '<span><i style="background:var(--blue)"></i>TCP</span><span><i style="background:var(--coral)"></i>UDP</span>'
    $('chNetL').innerHTML =
      '<span><i style="background:var(--blue)"></i>下行 IN</span><span><i style="background:var(--coral)"></i>上行 OUT</span>'
  } else {
    box.innerHTML =
      pingBox('chPingP', '默认四线', 'LATENCY · MS · DEFAULT') +
      pingBox('chPingC', '自定义目标', 'LATENCY · MS · CUSTOM')
    const d = await fetchPing(uuid, hours)
    if (tok !== S._detTok) return
    if (d.defs) setEchoTaskDefs(d.defs)
    drawPingGroup('chPingP', 'preset', d.tasks, uuid)
    drawPingGroup('chPingC', 'custom', d.tasks, uuid)
  }
}
/** One latency group: its own box, line stats and chart scale. */
function pingBox(id: string, title: string, en: string) {
  return `<div class="cc card wide ping-group" id="${id}Box"><div class="cc-h"><h3>${title}</h3><span class="en">${en}</span></div><div class="pstats" id="${id}S"></div><div class="cv" id="${id}"><div class="loading">LOADING · 载入中</div></div></div>`
}
function drawPingGroup(id: string, group: 'preset' | 'custom', tasks: PingStat[], uuid: string) {
  const { lines, empty } = pingLines(tasks, uuid, group)
  // A group with nothing to list collapses to one line instead of an empty 280 px chart.
  $(id + 'Box').classList.toggle('empty', !!empty)
  if (empty) {
    $(id).innerHTML = `<div class="loading">${esc(empty)}</div>`
    return
  }
  const drawn = lines.filter(l => l.task)
  $(id + 'S').innerHTML = lines
    .map(l => {
      const t = l.task
      return `<div class="card${t ? '' : ' wait'}" title="${esc(l.title)}"><div class="h"><i style="background:${css(l.color)}"></i>${esc(l.name)}</div><div class="r">${
        t
          ? `<span>AVG <b>${fMs(t.avg)}</b></span><span>${t.p99 != null ? 'P99' : 'MAX'} <b>${fMs(t.p99 != null ? t.p99 : t.max)}</b></span><span>LOSS <b style="color:${t.loss >= 5 ? 'var(--coral)' : t.loss > 0 ? 'var(--amber)' : 'inherit'}">${t.loss != null ? t.loss.toFixed(1) + '%' : '--'}</b></span>`
          : `<span>${esc(l.message || '暂无样本')}</span>`
      }</div></div>`
    })
    .join('')
  if (!drawn.length) {
    $(id + 'Box').classList.add('empty')
    $(id).innerHTML =
      '<div class="loading">' +
      (group === 'preset' ? '默认四线' : '自定义目标') +
      '暂无样本 · 见上方各线状态</div>'
    return
  }
  chart($(id), {
    series: drawn.map(l => ({ name: l.name, color: l.color, pts: l.task.pts, fill: drawn.length === 1 })),
    fmt: v => (v >= 100 ? Math.round(v) + '' : v.toFixed(v < 10 ? 1 : 0)),
    smooth: true,
  })
}
const PAL = ['blue', 'coral', 'amber', 'violet', 'cyan', 'ink2', '#5f9e6e', '#c97a4a']

/* Komari's metric store keeps memory.used / disk.used in bytes but no totals, and the legacy
   records rebuilt from it carry ram_total / disk_total = 0; the node's own totals are the base. */
function capacity(uuid: string, key: 'mem_total' | 'disk_total'): number {
  const n = nodeBy(uuid),
    l = S.live[uuid]
  return (n && n[key]) || (l && l[key]) || 0
}
const usedPct = (used: number | null | undefined, total: number): number | null =>
  used == null || !(total > 0) ? null : Math.min(100, (used / total) * 100)

async function fetchLoad(uuid, hours) {
  const out = { cpu: [], ram: [], disk: [], netIn: [], netOut: [], tcp: [], udp: [] }
  const memT = capacity(uuid, 'mem_total'),
    diskT = capacity(uuid, 'disk_total')
  if (await hasMetricStore()) {
    try {
      const ss = await queryMetrics(
        [
          'cpu.usage',
          'memory.used',
          'memory.total',
          'disk.used',
          'disk.total',
          'net.in.rate',
          'net.out.rate',
          'connections.tcp',
          'connections.udp',
        ],
        { uuid, hours, max: 360 },
      )
      const g = k => {
        const s = ss.find(x => x.metric_key === k)
        return (s && s.points) || []
      }
      const pts = k => g(k).map(p => [+new Date(p.time), p.value])
      /* a *.total series only exists on servers that define it; otherwise the node's capacity */
      const ratio = (u, t, cap) => {
        const T = g(t)
        return g(u).map((p, i) => [+new Date(p.time), usedPct(p.value, (T[i] && T[i].value) || cap)])
      }
      out.cpu = pts('cpu.usage')
      out.ram = ratio('memory.used', 'memory.total', memT)
      out.disk = ratio('disk.used', 'disk.total', diskT)
      out.netIn = pts('net.in.rate')
      out.netOut = pts('net.out.rate')
      out.tcp = pts('connections.tcp')
      out.udp = pts('connections.udp')
      if (out.cpu.length) return out
    } catch (e) {}
  }
  try {
    const d = await getJson('/api/records/load?uuid=' + encodeURIComponent(uuid) + '&hours=' + hours)
    ;(d.records || []).forEach(r => {
      const t = +new Date(r.time)
      out.cpu.push([t, r.cpu])
      /* very old servers sent percentages here; current ones send bytes with a zero total */
      out.ram.push([t, r.ram != null && r.ram <= 100 ? r.ram : usedPct(r.ram, r.ram_total || memT)])
      out.disk.push([t, r.disk != null && r.disk <= 100 ? r.disk : usedPct(r.disk, r.disk_total || diskT)])
      out.netIn.push([t, r.net_in])
      out.netOut.push([t, r.net_out])
      out.tcp.push([t, r.connections])
      out.udp.push([t, r.connections_udp])
    })
  } catch (e) {}
  return out
}
type PingTrack = { id: number; pts: [number, number | null][]; lossAt: Map<number, number> }
async function fetchPing(uuid, hours) {
  if (await hasMetricStore()) {
    try {
      const [ss, defs, stats] = await Promise.all([
        queryMetrics(['ping.latency_ms', 'ping.loss'], { uuid, hours, max: 400 }),
        pingTasks(),
        rpc2('public:getPingMetricStats', { uuid, hours })
          .then(r => (r && r.stats) || [])
          .catch(() => []),
      ])
      const by: Record<number, PingTrack> = {}
      ss.forEach(s => {
        const id = Number(s.tags && s.tags.task_id)
        if (!isFinite(id)) return
        const t = (by[id] = by[id] || { id, pts: [], lossAt: new Map() })
        /* -1 is a timeout sample, not a latency: leave a gap like the legacy path does */
        if (s.metric_key === 'ping.latency_ms')
          t.pts = (s.points || []).map(p => [
            +new Date(p.time),
            p.value != null && p.value >= 0 ? p.value : null,
          ])
        else (s.points || []).forEach(p => p.value != null && t.lossAt.set(+new Date(p.time), p.value))
      })
      // Definitions can exist before the first sample. Keep assigned tasks as waiting
      // rows instead of treating an empty metrics response as "no custom targets".
      defs.forEach(d => {
        if (!by[d.id] && (!Array.isArray(d.clients) || d.clients.includes(uuid)))
          by[d.id] = { id: d.id, pts: [], lossAt: new Map() }
      })
      const tasks = Object.values(by)
        .map(t => {
          const def: Partial<PingTaskDef> = defs.find(d => d.id === t.id) || {},
            st =
              stats.find(x => Number(x.task_id != null ? x.task_id : x.tags && x.tags.task_id) === t.id) || {}
          const v = t.pts.map(p => p[1]).filter(x => x != null),
            lp = [...t.lossAt.values()]
          /* Mean of the (already corrected) buckets, each weighted by its share of answered
             probes. Komari's own stats average carries the timeout bias once anything was lost. */
          let w = 0,
            sum = 0
          t.pts.forEach(([at, val]) => {
            if (val == null) return
            const k = 1 - (t.lossAt.get(at) || 0)
            w += k
            sum += val * k
          })
          return {
            id: t.id,
            name: def.name || st.name || 'Task ' + t.id,
            pts: t.pts,
            avg: st.avg != null && !lp.some(x => x > 0) ? st.avg : w > 0 ? sum / w : null,
            p99: st.p99,
            max: st.max != null ? st.max : v.length ? Math.max(...v) : null,
            loss:
              st.loss != null
                ? st.loss
                : lp.length
                  ? (lp.reduce((a, b) => a + b, 0) / lp.length) * 100
                  : null,
          }
        })
        .sort((a, b) => a.id - b.id)
      if (tasks.length || defs.length) return { tasks, defs }
    } catch (e) {}
  }
  try {
    const d = await getJson('/api/records/ping?uuid=' + encodeURIComponent(uuid) + '&hours=' + hours)
    const tasks = (d.tasks || []).map(t => {
      const rs = (d.records || []).filter(r => r.task_id === t.id)
      const pts = rs.map(r => [+new Date(r.time), r.value >= 0 ? r.value : null])
      const v = pts.map(p => p[1]).filter(x => x != null)
      return {
        id: t.id,
        name: t.name,
        pts,
        avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null,
        max: v.length ? Math.max(...v) : null,
        loss: rs.length ? ((rs.length - v.length) / rs.length) * 100 : t.loss != null ? t.loss : null,
      }
    })
    return { tasks, defs: d.tasks || [] }
  } catch (e) {
    // Unknown, not empty: a failed request must not clear the task list Echo already has.
    return { tasks: [], defs: undefined }
  }
}

/* Event wiring, called once from main after the views are mounted. */
function bindDetail() {
  $('detTabs').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    S.det.tab = b.dataset.t
    rDetCharts()
  })
  $('detHours').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    S.det.hours = +b.dataset.h
    rDetCharts()
  })
}

export { bindDetail, HOURS, openDetail, rDetCharts, uDetail }
