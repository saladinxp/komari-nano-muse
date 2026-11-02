/* Static Echo history: one hour, one global latency scale and four SVG paths.
   Samples from the metric store have already had timeout bias removed by queryMetrics. */
export interface EchoSample {
  t: number
  lat: number | null
  loss: number | null
  timeout?: boolean
  hasLatency?: boolean
}
export interface EchoTrendTask {
  points: EchoSample[]
  samples?: EchoSample[]
  loss?: number | null
  /** Probe cadence in seconds; metric bucket duration is separate. */
  interval?: number
  bucketSeconds?: number
}
export type EchoQuality = 'stable' | 'unstable' | 'lost' | 'missing' | 'pending'
export interface EchoCell {
  start: number
  end: number
  latency: number | null
  loss: number | null
  quality: EchoQuality
  height: number
}
const HOUR = 3_600_000
const BASE_MS = 10
const FULL_MS = 400

function cadence(task: EchoTrendTask): number {
  return Number.isFinite(task.interval) && task.interval > 0 ? Math.max(60, task.interval) : 60
}
function maxCells(task: EchoTrendTask): number {
  return Math.max(1, Math.floor(3600 / cadence(task)))
}
/** Preserve thin strokes on wider charts, but never imply observations more
    often than the task runs (a 300s task gets at most twelve cells per hour). */
export function echoCellCount(width: number, interval = 60): number {
  const desired = Math.max(30, Math.min(60, Math.floor(Math.max(0, width) / 22.5) * 5))
  return Math.min(desired, maxCells({ points: [], interval }))
}
export function echoHeight(latency: number): number {
  const ms = Math.max(BASE_MS, Math.min(FULL_MS, latency))
  return 0.5 + (0.5 * Math.log(ms / BASE_MS)) / Math.log(FULL_MS / BASE_MS)
}
function samplesOf(task: EchoTrendTask): EchoSample[] {
  return task.samples || task.points || []
}
export function echoCells(task: EchoTrendTask, now = Date.now(), count = 30): EchoCell[] {
  count = Math.max(1, Math.min(maxCells(task), 60, Math.round(count)))
  const start = now - HOUR,
    step = HOUR / count
  const bucketSeconds = Number.isFinite(task.bucketSeconds) && task.bucketSeconds > 0 ? task.bucketSeconds : 0
  // Store timestamps are bucket starts. Put their evidence at the midpoint;
  // an already returned partial current bucket belongs at the current edge.
  const samples = samplesOf(task)
    .filter(p => Number.isFinite(p.t) && p.t <= now)
    .map(p => ({ ...p, t: Math.min(now, p.t + bucketSeconds * 500) }))
    .filter(p => p.t >= start)
  const successful = (p: EchoSample) =>
    typeof p.lat === 'number' && Number.isFinite(p.lat) && p.lat >= 0 && !p.timeout && p.loss !== 1
  const observed = samples.filter(p => successful(p) || p.timeout || p.loss === 1)
  const latest = observed.length ? Math.max(...observed.map(p => p.t)) : null
  const values = samples
    .filter(successful)
    .map(p => p.lat!)
    .sort((a, b) => a - b)
  const mid = Math.floor(values.length / 2)
  const median = values.length
    ? values.length % 2
      ? values[mid]
      : (values[mid - 1] + values[mid]) / 2
    : null
  const buckets = Array.from({ length: count }, () => ({
    sum: 0,
    answered: 0,
    failed: 0,
    unknownAnswer: false,
    observed: false,
  }))
  for (const p of samples) {
    const cell = buckets[Math.min(count - 1, Math.floor((p.t - start) / step))]
    cell.observed = true
    if (p.timeout || p.loss === 1) {
      cell.failed++
    } else if (successful(p)) {
      const loss = typeof p.loss === 'number' && p.loss >= 0 && p.loss <= 1 ? p.loss : 0
      // An aggregated metric point is the mean of answered samples. Weight it by
      // its answering fraction when a cell combines multiple equal-time buckets.
      cell.sum += p.lat! * (1 - loss)
      cell.answered += 1 - loss
      cell.failed += loss
    } else if (typeof p.loss === 'number' && p.loss > 0 && p.loss < 1) {
      // Partial loss without latency is incomplete data, never evidence of total loss.
      cell.unknownAnswer = true
    }
  }
  return buckets.map((b, i) => {
    const latency = b.answered > 0 ? b.sum / b.answered : null
    const loss = b.answered + b.failed > 0 ? b.failed / (b.answered + b.failed) : null
    const spike = latency != null && median != null && latency > median * 1.5 && latency - median >= 20
    let quality: EchoQuality =
      latency != null
        ? b.failed > 0 || spike
          ? 'unstable'
          : 'stable'
        : b.failed > 0 && !b.unknownAnswer
          ? 'lost'
          : 'missing'
    // The next expected observation has not arrived yet. Only the final cell
    // can be pending, and only while an actual recent observation is fresh.
    // Offline gaps, never-started tasks and earlier missing cells stay grey.
    if (
      quality === 'missing' &&
      !b.observed &&
      i === count - 1 &&
      latest != null &&
      now - latest < (cadence(task) + bucketSeconds / 2) * 1000
    )
      quality = 'pending'
    return {
      start: start + i * step,
      end: start + (i + 1) * step,
      latency,
      loss,
      quality,
      height: latency == null ? 0.5 : echoHeight(latency),
    }
  })
}
export function echoTimeoutHint(task: EchoTrendTask): string {
  const observed = samplesOf(task).filter(p => p.lat != null || p.timeout || p.loss === 1)
  if (observed.length < 3 || !observed.slice(-3).every(p => p.timeout || p.loss === 1)) return ''
  return task.loss != null && task.loss >= 95 ? '目标可能不回应 ping' : '最近连续超时'
}
export function renderEchoTrend(task: EchoTrendTask, width: number, now = Date.now()): string {
  width = Math.max(1, width)
  const count = echoCellCount(width, task.interval),
    cells = echoCells(task, now, count),
    pitch = width / count
  const stroke = Math.min(3, Math.max(0.7, pitch - 1.5))
  const paths = { stable: '', unstable: '', lost: '', missing: '' }
  const n = (v: number) => v.toFixed(2)
  for (const [i, cell] of cells.entries()) {
    const x = (i + 0.5) * pitch
    if (cell.quality === 'pending') continue
    if (cell.quality === 'missing') {
      const left = x - stroke / 2
      paths.missing += `M${n(left)} 11h${n(stroke)}v11h-${n(stroke)}Z`
    } else {
      const top = cell.quality === 'lost' ? 19.8 : 22 - cell.height * 22
      paths[cell.quality] += `M${n(x)} ${n(top)}V22`
    }
  }
  return `<svg viewBox="0 0 ${n(width)} 24" preserveAspectRatio="none" role="img" aria-label="最近1小时：高度表示延迟，颜色表示稳定性" data-echo-cells="${count}" data-echo-scale="10-400-log"><title>最近1小时 · ${count}格 · 同一10–400ms对数刻度 · 青色稳定，琥珀色波动或部分丢包，红短标整格丢包，灰框无数据；末格未到采样时留空</title><path class="echo-bars-stable" d="${paths.stable}" stroke-width="${n(stroke)}"/><path class="echo-bars-unstable" d="${paths.unstable}" stroke-width="${n(stroke)}"/><path class="echo-bars-lost" d="${paths.lost}" stroke-width="${n(stroke)}"/><path class="echo-bars-missing" d="${paths.missing}"/></svg>`
}
