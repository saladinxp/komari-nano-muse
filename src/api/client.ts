import { S } from '../state'
import type { MetricSeries, PingTaskDef } from '../types/komari'

/* ── API ── */
async function getJson(p) {
  const r = await fetch(p, { credentials: 'include', headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(p + ' ' + r.status)
  const j = await r.json()
  return j && j.data !== undefined ? j.data : j
}
async function rpc2(method, params) {
  const r = await fetch('/api/rpc2', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!r.ok) throw new Error('rpc2 ' + r.status)
  const b = await r.json()
  if (b.error) throw new Error(b.error.message)
  if (b.result === undefined) throw new Error('empty')
  return b.result
}
/* Metric store (Komari ≥ 1.2.6). `null` names = the store exists but its definitions carried no
   readable names, so every requested key is sent as is. */
let _ms: Promise<{ ok: boolean; names: Set<string> | null }> | null = null
function resetMetricStore() {
  _ms = null
}
function metricStore() {
  if (!_ms)
    _ms = rpc2('public:listMetricDefinitions', {})
      .then(d => {
        const list = Array.isArray(d) ? d : []
        const names = list.map(x => x && (x.name || x.key)).filter(x => typeof x === 'string')
        return { ok: list.length > 0, names: names.length ? new Set<string>(names) : null }
      })
      .catch(() => ({ ok: false, names: null }))
  return _ms
}
function hasMetricStore(): Promise<boolean> {
  return metricStore().then(m => m.ok)
}
/** Komari rejects the whole query when one key is unknown ("unknown metric key"), so keys the
    server does not define are dropped first (e.g. memory.total, which current Komari lacks). */
async function queryMetrics(
  keys: string[],
  o: { hours?: number; max?: number; uuid?: string },
): Promise<MetricSeries[]> {
  const { names } = await metricStore()
  const known = names ? keys.filter(k => names.has(k)) : keys
  if (!known.length) return []
  const p: Record<string, unknown> = { metric_keys: known, max_points: o.max || 300, hours: o.hours || 1 }
  if (o.uuid) p.entity_id = o.uuid
  const r = await rpc2('public:queryMetrics', p)
  return unbiasPing((r && r.series) || [])
}
/** Komari writes every probe twice at the same instant: `ping.latency_ms` (-1 on a timeout) and
    `ping.loss` (0 or 1), and averages each per bucket when it downsamples. A bucket whose loss
    ratio is L and latency mean is A therefore holds answered probes averaging (A + L) / (1 − L).
    Uncorrected, a partly lost bucket reads low, and on a sub-millisecond target it even goes
    negative, which every view reads as a timeout. Raw points (L = 0 or 1) pass unchanged. */
function unbiasPing(series: MetricSeries[]): MetricSeries[] {
  const key = (s: MetricSeries) => (s.entity_id || '') + '|' + ((s.tags && s.tags.task_id) ?? '')
  const loss = new Map<string, Map<number, number>>()
  for (const s of series) {
    if (s.metric_key !== 'ping.loss' || !Array.isArray(s.points)) continue
    const at = new Map<number, number>()
    for (const p of s.points) if (p && typeof p.value === 'number') at.set(+new Date(p.time), p.value)
    loss.set(key(s), at)
  }
  if (!loss.size) return series
  return series.map(s => {
    const at = s.metric_key === 'ping.latency_ms' && Array.isArray(s.points) && loss.get(key(s))
    if (!at) return s
    return {
      ...s,
      points: s.points.map(p => {
        const l = p && typeof p.value === 'number' ? at.get(+new Date(p.time)) : undefined
        if (l == null || !(l > 0) || l >= 1) return p
        const v = (p.value + l) / (1 - l)
        return Number.isFinite(v) && v >= 0 ? { ...p, value: v } : p
      }),
    }
  })
}
let _tasks: Promise<PingTaskDef[]> | null = null
function resetPingTasks() {
  _tasks = null
}
function pingTasks() {
  if (!_tasks)
    _tasks = rpc2('public:getPublicPingTasks', {})
      .then(t => (Array.isArray(t) ? t : []))
      .catch(() => [])
  return _tasks
}
/** Whether a node has probes assigned. Current Komari lists each task's clients;
    older servers do not, so any task counts as configured there. */
function probesFor(defs: PingTaskDef[], uuid: string): boolean {
  if (!defs.length) return false
  if (!defs.some(d => Array.isArray(d.clients))) return true
  return defs.some(d => Array.isArray(d.clients) && d.clients.includes(uuid))
}
async function pmap(items, fn, limit) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++
        try {
          out[k] = await fn(items[k], k)
        } catch (e) {
          out[k] = null
        }
      }
    }),
  )
  return out
}

async function loadPublic() {
  try {
    const d = await getJson('/api/public')
    S.site = d.sitename || 'Komari'
    S.ts = d.theme_settings || {}
    if (d.record_preserve_time) S.recordHours = +d.record_preserve_time || 720
    if (d.ping_record_preserve_time) S.pingHours = +d.ping_record_preserve_time || 720
  } catch (e) {
    console.warn('[nm] public', e)
  }
}
async function loadNodes() {
  try {
    const d = await getJson('/api/nodes')
    S.nodes = (Array.isArray(d) ? d : []).sort((a, b) => (a.weight || 0) - (b.weight || 0))
  } catch (e) {
    console.warn('[nm] nodes', e)
  }
}
async function loadMe() {
  try {
    const d = await getJson('/api/me')
    S.loggedIn = !!d.logged_in
  } catch (e) {}
}

export {
  resetMetricStore,
  getJson,
  hasMetricStore,
  loadMe,
  loadNodes,
  loadPublic,
  pingTasks,
  pmap,
  probesFor,
  queryMetrics,
  resetPingTasks,
  rpc2,
  unbiasPing,
}
