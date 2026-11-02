import { hasMetricStore, queryMetrics } from '../api/client'
import { chart } from '../charts/chart'
import { S, visible } from '../state'
import { $, esc, fB, fK, fS, store } from '../utils/format'
import { metrics } from '../utils/metrics'
import { usageBlock, usageOf, updateUsageBlocks } from '../utils/usage'
import type { MetricSeries } from '../types/komari'

let group = store.get('traffic-group', 'ALL'),
  query = '',
  sort = 'usage',
  hours = 6
let pending = false,
  token = 0
const cache = new Map<number, { at: number; series: MetricSeries[] }>()
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
  list.sort((a, b) =>
    sort === 'live'
      ? (S.online.has(b.uuid) ? metrics(b).up + metrics(b).down : -1) -
        (S.online.has(a.uuid) ? metrics(a).up + metrics(a).down : -1)
      : sort === 'total'
        ? (usageOf(b).total ?? -1) - (usageOf(a).total ?? -1)
        : (usageOf(b).percent ?? -1) - (usageOf(a).percent ?? -1),
  )
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
      el.innerHTML = `<div class="traffic-node-head"><a href="/detail/${encodeURIComponent(n.uuid)}" data-nav></a><span data-traffic-k="status"></span></div>${usageBlock(n)}<div class="traffic-node-pair"><span data-traffic-k="tu"></span><span data-traffic-k="td"></span></div><div class="traffic-node-pair"><span data-traffic-k="up"></span><span data-traffic-k="down"></span></div>`
    }
    const u = usageOf(n),
      m = metrics(n),
      online = S.online.has(n.uuid)
    el.querySelector('a').textContent = n.name
    const text = {
      status: online ? '在线' : '离线',
      tu: '↑ 累计 ' + (u.up == null ? '—' : fB(u.up)),
      td: '↓ 累计 ' + (u.down == null ? '—' : fB(u.down)),
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
export function openTraffic() {
  rTraffic()
  void loadTrafficHistory()
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
