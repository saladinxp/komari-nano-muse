/* The last 24 hours, the way Komari's own admin dashboard counts them
   (komari-web src/pages/admin/dashboard.tsx, computeTrafficSummary / computeTopAverageItems),
   so the theme and the admin panel show the same numbers:

   - one public:queryMetrics call over 24 h with Komari's default 500 buckets, p95 per bucket,
     except traffic.up / traffic.down summed (bytes per bucket), net.total.* last, cpu.usage
     and memory.used averaged;
   - usage per node = the sum of its traffic deltas, skipping a bucket where its cumulative
     net.total counter restarted (went down, or came back after a gap): that first delta after
     a reset is a baseline, not traffic;
   - peak = the bucket with the highest up + down rate; averages are weighted by each
     bucket's sample count.

   A server that does not know these keys, or ignored the requested aggregation (a downsampled
   series whose algorithm is not the one asked for), yields nothing rather than wrong numbers. */
import type { MetricSeries } from '../types/komari'

export const DAY_KEYS = [
  'traffic.up',
  'traffic.down',
  'net.total.up',
  'net.total.down',
  'net.in.rate',
  'net.out.rate',
  'cpu.usage',
  'memory.used',
]
export const DAY_QUERY = {
  hours: 24,
  max: 500,
  fill: true,
  aggregation: 'p95',
  byMetric: {
    'traffic.up': 'sum',
    'traffic.down': 'sum',
    'net.total.up': 'last',
    'net.total.down': 'last',
    'cpu.usage': 'avg',
    'memory.used': 'avg',
  } as Record<string, string>,
}

/** The series is aggregated the way it was asked for (or not downsampled at all). */
export function honoured(s: MetricSeries): boolean {
  if (!s.downsampled) return true
  const want = DAY_QUERY.byMetric[s.metric_key] || DAY_QUERY.aggregation
  return !s.downsample_algorithm || s.downsample_algorithm === want
}

export interface DayTraffic {
  uuid: string
  up: number
  down: number
  total: number
  /** Highest up + down rate in one bucket, B/s, and its bucket time (ms); 0 when unknown. */
  peakRate: number
  peakTime: number
}
export interface DayTotals {
  nodes: DayTraffic[]
  up: number
  down: number
}

const at = (t: string) => new Date(t).getTime()

/** Buckets (entity, direction, time) whose traffic delta is only a counter baseline. */
function resets(series: MetricSeries[]): Set<string> {
  const out = new Set<string>()
  for (const s of series) {
    if (s.metric_key !== 'net.total.up' && s.metric_key !== 'net.total.down') continue
    const dir = s.metric_key === 'net.total.up' ? 'up' : 'down'
    let prev: number | null = null,
      gap = false,
      rebound: number | null = null
    for (const p of s.points || []) {
      if (p.value == null) {
        if (prev !== null) gap = true
        continue
      }
      let reset = gap
      if (prev !== null && p.value < prev) {
        reset = true
        rebound = prev
      } else if (rebound !== null) {
        if (p.value >= rebound) reset = true
        rebound = null
      }
      if (reset) out.add(`${s.entity_id}\0${dir}\0${at(p.time)}`)
      prev = p.value
      gap = false
    }
  }
  return out
}

/** 24 h usage per node (only `ids`), largest first, with fleet totals. Null when the server
    sent no usable traffic deltas. */
export function dayTraffic(series: MetricSeries[], ids: Set<string>): DayTotals | null {
  const base = resets(series),
    use = new Map<string, { up: number; down: number }>(),
    rate = new Map<string, Map<number, number>>()
  let seen = false
  for (const s of series) {
    const id = s.entity_id
    if (!id || !ids.has(id) || !honoured(s)) continue
    const isRate = s.metric_key === 'net.in.rate' || s.metric_key === 'net.out.rate',
      isUse = s.metric_key === 'traffic.up' || s.metric_key === 'traffic.down'
    if (!isRate && !isUse) continue
    const up = s.metric_key === 'traffic.up'
    for (const p of s.points || []) {
      if (p.value == null || !Number.isFinite(p.value) || p.value < 0) continue
      const t = at(p.time)
      if (isRate) {
        const m = rate.get(id) || new Map<number, number>()
        m.set(t, (m.get(t) || 0) + p.value)
        rate.set(id, m)
        continue
      }
      if (base.has(`${id}\0${up ? 'up' : 'down'}\0${t}`)) continue
      const e = use.get(id) || { up: 0, down: 0 }
      if (up) e.up += p.value
      else e.down += p.value
      use.set(id, e)
      seen = true
    }
  }
  if (!seen) return null
  const nodes = [...use].map(([uuid, v]) => {
    let peakRate = 0,
      peakTime = 0
    for (const [t, r] of rate.get(uuid) || []) if (r > peakRate) [peakRate, peakTime] = [r, t]
    return { uuid, up: v.up, down: v.down, total: v.up + v.down, peakRate, peakTime }
  })
  nodes.sort((a, b) => b.total - a.total)
  return {
    nodes,
    up: nodes.reduce((a, n) => a + n.up, 0),
    down: nodes.reduce((a, n) => a + n.down, 0),
  }
}

export interface DayAverage {
  uuid: string
  /** 24 h average and the highest bucket, already converted (percent). */
  value: number
  peak: number
  peakTime: number
}

/** 24 h average per node of `key`, highest first. `toPercent` turns a raw value into percent
    (cpu.usage is already a percent; memory.used is bytes over the node's mem_total). */
export function dayAverage(
  series: MetricSeries[],
  key: string,
  ids: Set<string>,
  toPercent: (uuid: string, v: number) => number,
): DayAverage[] {
  const out: DayAverage[] = []
  for (const s of series) {
    const id = s.entity_id
    if (s.metric_key !== key || !id || !ids.has(id) || !honoured(s)) continue
    let sum = 0,
      weight = 0,
      peak = -Infinity,
      peakTime = 0
    for (const p of s.points || []) {
      const c = p.count ?? 1
      if (p.value == null || !Number.isFinite(p.value) || !(c > 0)) continue
      sum += p.value * c
      weight += c
      if (p.value > peak) [peak, peakTime] = [p.value, at(p.time)]
    }
    if (!weight) continue
    const value = toPercent(id, sum / weight)
    if (Number.isFinite(value)) out.push({ uuid: id, value, peak: toPercent(id, peak), peakTime })
  }
  return out.sort((a, b) => b.value - a.value)
}

/** "今天 08:55" / "昨天 19:05" / "11-02 19:05", in the visitor's local time. */
export function dayLabel(t: number, now = Date.now()): string {
  const d = new Date(t),
    today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const day = Math.round((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 864e5)
  return day === 0
    ? '今天 ' + hm
    : day === 1
      ? '昨天 ' + hm
      : `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`
}
