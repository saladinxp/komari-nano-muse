import { hasMetricStore, queryMetrics } from '../api/client'
import { chart } from '../charts/chart'
import { S, thr, visible } from '../state'
import { DAY_KEYS, DAY_QUERY, dayAverage, dayLabel, dayTraffic, type DayTotals } from '../utils/day-usage'
import { $, esc, fB, fK, fS, store } from '../utils/format'
import { metrics } from '../utils/metrics'
import { usageBlock, usageOf, updateUsageBlocks } from '../utils/usage'
import type { KomariNode, MetricSeries } from '../types/komari'

let group = store.get('traffic-group', 'ALL'),
  query = '',
  sort = 'usage',
  hours = 6
let pending = false,
  token = 0
const cache = new Map<number, { at: number; series: MetricSeries[] }>()
/* Last 24 hours (usage, average load): one query, kept for five minutes. With a full day of
   data it is ~200 KB per node (8 metrics × 500 buckets, Komari does not compress), so it is
   read on opening the page and then at most every 5 minutes while the tab is visible.
   `null` = not loaded, 'none' = this Komari has no usable 24 h data, 'error' = the request failed. */
const DAY_REFRESH = 5 * 60_000
let day: { at: number; series: MetricSeries[] } | 'none' | 'error' | null = null,
  dayPending = false,
  dayTried = 0
const availableHours = () => [1, 6, 24, 168].filter(h => h <= Math.max(1, S.recordHours))
const historyKey = () =>
  hours +
  '|' +
  nodes()
    .map(n => n.uuid)
    .sort()
    .join(',')
const nodes = () =>
  visible().filter(n => (group === 'ALL' || n.group === group) && n.name.toLowerCase().includes(query))

/** A sum of known samples, with contribution counts. Missing samples are never treated as zero. */
export function aggregateThroughput(series: MetricSeries[], ids: Set<string>, key: string) {
  const by = new Map<number, { sum: number; ids: Set<string> }>()
  for (const s of series) {
    if (s.metric_key !== key || !ids.has(s.entity_id)) continue
    for (const p of s.points || []) {
      const t = +new Date(p.time),
        v = p.value
      if (!Number.isFinite(t)) continue
      const bucket = by.get(t) || { sum: 0, ids: new Set<string>() }
      by.set(t, bucket)
      if (v == null || !Number.isFinite(v) || v < 0) continue
      if (!bucket.ids.has(s.entity_id)) {
        bucket.sum += v
        bucket.ids.add(s.entity_id)
      }
      by.set(t, bucket)
    }
  }
  return [...by]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => ({ t, value: b.ids.size ? b.sum : null, contributors: b.ids.size }))
}

export function rTraffic() {
  if (S.page !== 'traffic') return
  const groups = [
    ...new Set(
      visible()
        .map(n => n.group)
        .filter(Boolean),
    ),
  ]
  if (group !== 'ALL' && !groups.includes(group)) group = 'ALL'
  const groupOptions =
    '<option value="ALL">全部分组</option>' +
    groups.map(g => `<option value="${esc(g)}"${g === group ? ' selected' : ''}>${esc(g)}</option>`).join('')
  if ($('trafficGroup').innerHTML !== groupOptions) $('trafficGroup').innerHTML = groupOptions
  const list = nodes(),
    known = list.map(usageOf).filter(u => u.known)
  const sum = (k: 'up' | 'down' | 'total') => known.reduce((v, u) => v + u[k], 0)
  const rate = list
    .filter(n => S.online.has(n.uuid))
    .reduce((v, n) => {
      const m = metrics(n)
      return v + m.up + m.down
    }, 0)
  const tile = (label: string, value: string, sub: string) =>
    `<div class="tile card"><span>${label}</span><b class="num">${value}</b><em>${sub}</em></div>`
  $('trafficTiles').innerHTML =
    tile('累计上传', known.length ? fB(sum('up')) : '—', 'TX · 节点累计计数') +
    tile('累计下载', known.length ? fB(sum('down')) : '—', 'RX · 节点累计计数') +
    tile('累计双向', known.length ? fB(sum('total')) : '—', `${known.length} / ${list.length} 台有流量数据`) +
    tile('实时吞吐', S.lastSync ? fS(rate) : '—', '仅在线节点 · 上下行合计')
  $('trafficScope').textContent =
    '按节点最近上报计数展示；配额在后台填写。按月用量需在 Agent 配置重置日。离线节点保留上次读数。'
  const totals = dayTotals(list),
    d24 = totals ? new Map(totals.nodes.map(x => [x.uuid, x])) : null
  list.sort((a, b) =>
    sort === 'day'
      ? (d24?.get(b.uuid)?.total ?? -1) - (d24?.get(a.uuid)?.total ?? -1)
      : sort === 'live'
        ? (S.online.has(b.uuid) ? metrics(b).up + metrics(b).down : -1) -
          (S.online.has(a.uuid) ? metrics(a).up + metrics(a).down : -1)
        : sort === 'total'
          ? (usageOf(b).total ?? -1) - (usageOf(a).total ?? -1)
          : (usageOf(b).percent ?? -1) - (usageOf(a).percent ?? -1),
  )
  renderDay(list, totals)
  if (day !== 'none') void loadDay()
  const host = $('trafficNodes')
  if (!list.length) {
    host.innerHTML = '<div class="empty">' + (S._loaded ? '没有匹配的节点' : '等待节点数据') + '</div>'
    return
  }
  host.querySelector('.empty')?.remove()
  const wanted = new Set(list.map(n => n.uuid))
  host.querySelectorAll<HTMLElement>('[data-traffic-node]').forEach(el => {
    if (!wanted.has(el.dataset.trafficNode)) el.remove()
  })
  list.forEach((n, index) => {
    let el = [...host.querySelectorAll<HTMLElement>('[data-traffic-node]')].find(
      e => e.dataset.trafficNode === n.uuid,
    )
    if (!el) {
      el = document.createElement('article')
      el.className = 'card traffic-node'
      el.dataset.trafficNode = n.uuid
      el.innerHTML = `<div class="traffic-node-head"><a href="/detail/${encodeURIComponent(n.uuid)}" data-nav></a><span data-traffic-k="status"></span></div>${usageBlock(n)}<div class="traffic-node-pair"><span data-traffic-k="tu"></span><span data-traffic-k="td"></span></div><div class="traffic-node-pair day-pair"><span data-traffic-k="du"></span><span data-traffic-k="dd"></span></div><div class="traffic-node-pair"><span data-traffic-k="up"></span><span data-traffic-k="down"></span></div>`
    }
    const u = usageOf(n),
      m = metrics(n),
      online = S.online.has(n.uuid)
    el.querySelector('a').textContent = n.name
    const text = {
      status: online ? '在线' : '离线',
      tu: '↑ 累计 ' + (u.up == null ? '—' : fB(u.up)),
      td: '↓ 累计 ' + (u.down == null ? '—' : fB(u.down)),
      du: '↑ 24h ' + (d24 ? fB(d24.get(n.uuid)?.up ?? 0) : '—'),
      dd: '↓ 24h ' + (d24 ? fB(d24.get(n.uuid)?.down ?? 0) : '—'),
      up: '↑ ' + (online ? fS(m.up) : '—'),
      down: '↓ ' + (online ? fS(m.down) : '—'),
    }
    el.querySelectorAll<HTMLElement>('[data-traffic-k]').forEach(
      e => (e.textContent = text[e.dataset.trafficK]),
    )
    if (host.children[index] !== el) host.insertBefore(el, host.children[index] || null)
  })
  updateUsageBlocks()
}

export async function loadTrafficHistory(force = false) {
  if (S.page !== 'traffic' || !S._loaded) return
  if (!availableHours().includes(hours)) hours = availableHours()[0]
  $('trafficHours').innerHTML = availableHours()
    .map(
      h =>
        `<button data-hours="${h}" class="${h === hours ? 'on' : ''}">${h >= 24 ? h / 24 + 'D' : h + 'H'}</button>`,
    )
    .join('')
  const ids = new Set(nodes().map(n => n.uuid)),
    key = historyKey(),
    requested = hours
  if (pending) {
    $('trafficChart').innerHTML = '<div class="loading">正在切换查询范围…</div>'
    return
  }
  const current = () => S.page === 'traffic' && historyKey() === key
  const draw = (series: MetricSeries[]) => {
    const up = aggregateThroughput(series, ids, 'net.out.rate'),
      down = aggregateThroughput(series, ids, 'net.in.rate')
    const points = [...up, ...down]
    if (!points.some(p => p.value != null)) {
      $('trafficChart').innerHTML = '<div class="loading">所选范围暂无吞吐历史</div>'
      $('trafficHistoryMeta').textContent = '缺少历史样本不按 0 处理。'
      return
    }
    const counts = points.map(p => p.contributors)
    $('trafficHistoryMeta').textContent =
      `有数据节点汇总 · 每个采样 ${Math.min(...counts)}–${Math.max(...counts)} / ${ids.size} 台 · 速率趋势（B/s），非区间用量`
    chart($('trafficChart'), {
      series: [
        { name: '↑ 上传', color: 'blue', pts: up.map(p => [p.t, p.value]) },
        { name: '↓ 下载', color: 'cyan', pts: down.map(p => [p.t, p.value]) },
      ],
      fmt: (v, ax) => (ax ? fK(v) : fS(v)),
    })
  }
  const saved = cache.get(requested)
  if (!force && saved && Date.now() - saved.at < 60000) {
    draw(saved.series)
    return
  }
  pending = true
  const request = ++token
  $('trafficHistoryMeta').textContent = '正在读取所选范围的吞吐历史…'
  try {
    if (!(await hasMetricStore())) {
      if (!current()) return
      $('trafficChart').innerHTML =
        '<div class="loading">此版本未提供批量历史，请在节点详情查看网络历史</div>'
      $('trafficHistoryMeta').textContent = '累计计数与实时速率仍可正常查看。'
      return
    }
    const series = await queryMetrics(['net.in.rate', 'net.out.rate'], { hours: requested, max: 96 })
    cache.set(requested, { at: Date.now(), series })
    if (request === token && current()) draw(series)
  } catch (e) {
    if (current()) {
      $('trafficHistoryMeta').textContent = '历史读取失败，请稍后重试'
      $('trafficChart').innerHTML = '<div class="loading">暂时无法读取历史</div>'
    }
  } finally {
    pending = false
    if (S.page === 'traffic' && historyKey() !== key) void loadTrafficHistory()
  }
}
/* ── last 24 hours ── */
function dayTotals(list: { uuid: string }[]): DayTotals | null {
  return day && typeof day === 'object' ? dayTraffic(day.series, new Set(list.map(n => n.uuid))) : null
}
const nameOf = (uuid: string) => S.nodes.find(n => n.uuid === uuid)?.name || uuid.slice(0, 8)
const link = (uuid: string) =>
  `<a href="/detail/${encodeURIComponent(uuid)}" data-nav>${esc(nameOf(uuid))}</a>`
const rank = (i: number) => `<span class="day-rank">${String(i + 1).padStart(2, '0')}</span>`
const peak = (what: string, t: number) =>
  t ? `<small>峰值 ${what} · ${dayLabel(t)}</small>` : '<small>峰值 —</small>'
function put(id: string, html: string) {
  const el = $(id)
  if (el.innerHTML !== html) el.innerHTML = html
}

function renderDay(list: KomariNode[], totals: DayTotals | null) {
  const wait = (text: string) => `<li class="day-wait">${text}</li>`
  if (!day || day === 'error' || day === 'none') {
    const text =
      day === 'none'
        ? '此版本 Komari 未提供 24 小时数据'
        : day === 'error'
          ? '暂时无法读取，稍后自动重试'
          : '正在读取最近 24 小时…'
    for (const id of ['dayUsage', 'dayCpu', 'dayMem']) put(id, wait(text))
    put('daySum', '')
    return
  }
  const ids = new Set(list.map(n => n.uuid)),
    mem = new Map(list.map(n => [n.uuid, n.mem_total || 0]))
  if (!totals || !totals.nodes.some(x => x.total > 0)) {
    put('dayUsage', wait('最近 24 小时没有流量样本'))
    put('daySum', '')
  } else {
    const top = totals.nodes.slice(0, 5),
      max = top[0].total || 1
    put('daySum', `<small>全部节点合计</small>↑ ${fB(totals.up)}  ↓ ${fB(totals.down)}`)
    put(
      'dayUsage',
      top
        .map(
          (x, i) =>
            `<li>${rank(i)}<div class="day-row"><div class="day-line">${link(x.uuid)}<b class="num"><i class="up">↑</i> ${fB(x.up)}<em><i class="down">↓</i> ${fB(x.down)}</em></b></div><i class="day-bar split" style="width:${((x.total / max) * 100).toFixed(1)}%"><i style="width:${x.total ? ((x.up / x.total) * 100).toFixed(1) : 0}%"></i></i>${peak(fS(x.peakRate), x.peakTime)}</div></li>`,
        )
        .join(''),
    )
  }
  const load = (key: string, id: string, limit: number, toPercent: (u: string, v: number) => number) => {
    const rows = dayAverage((day as { series: MetricSeries[] }).series, key, ids, toPercent).slice(0, 5)
    put(
      id,
      rows.length
        ? rows
            .map((x, i) => {
              const tone = x.value >= limit ? ' h' : x.value >= limit * 0.75 ? ' w' : ''
              return `<li>${rank(i)}<div class="day-row"><div class="day-line">${link(x.uuid)}<b class="num">${x.value.toFixed(1)}<small>%</small></b></div><i class="day-bar${tone}" style="width:${Math.min(100, Math.max(0, x.value)).toFixed(1)}%"></i>${peak(x.peak.toFixed(1) + '%', x.peakTime)}</div></li>`
            })
            .join('')
        : wait('最近 24 小时没有样本'),
    )
  }
  load('cpu.usage', 'dayCpu', thr('cpu'), (_, v) => v)
  load('memory.used', 'dayMem', thr('ram'), (u, v) => (mem.get(u) ? (v / mem.get(u)) * 100 : NaN))
}

async function loadDay(force = false) {
  if (S.page !== 'traffic' || !S._loaded || dayPending) return
  /* live updates call rTraffic often: re-read at most every 5 minutes, and not in a hidden tab */
  if (!force && day !== null && (document.hidden || Date.now() - dayTried < DAY_REFRESH)) return
  dayPending = true
  dayTried = Date.now()
  $('dayNote').textContent = '正在读取最近 24 小时…'
  try {
    if (!(await hasMetricStore())) day = 'none'
    else {
      const series = await queryMetrics(DAY_KEYS, DAY_QUERY)
      day = series.some(s => s.metric_key === 'traffic.up' || s.metric_key === 'cpu.usage')
        ? { at: Date.now(), series }
        : 'none'
    }
  } catch (e) {
    day = 'error'
  } finally {
    dayPending = false
  }
  $('dayNote').textContent =
    day === 'none'
      ? '需要带指标存储的 Komari（1.2.6 起）；累计计数与实时速率不受影响。'
      : '与 Komari 后台同一算法：按每次上报的增量求和，计数器重置的那一段不计；峰值为单段上下行合计，时间按你的本地时间。'
  rTraffic()
}

export function openTraffic() {
  rTraffic()
  void loadTrafficHistory()
  void loadDay()
}
export function bindTraffic() {
  $('trafficGroup').addEventListener('change', e => {
    group = (e.target as HTMLSelectElement).value
    store.set('traffic-group', group)
    rTraffic()
    void loadTrafficHistory()
  })
  $('trafficSearch').addEventListener('input', e => {
    query = (e.target as HTMLInputElement).value.trim().toLowerCase()
    rTraffic()
    void loadTrafficHistory()
  })
  $('trafficSort').addEventListener('change', e => {
    sort = (e.target as HTMLSelectElement).value
    rTraffic()
  })
  $('trafficHours').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-hours]')
    if (b) {
      hours = Number(b.dataset.hours)
      void loadTrafficHistory()
    }
  })
}
