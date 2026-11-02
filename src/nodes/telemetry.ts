/* One batched hour of throughput for all cards. The view owns no animation loop.
   Null buckets remain gaps; requests finish into the cache, never a departed view. */
import { hasMetricStore, queryMetrics } from '../api/client'
import { S, visible } from '../state'
import type { MetricSeries } from '../types/komari'

let at = 0
let epoch = 0
let pending: Promise<void> | null = null
let series: MetricSeries[] = []
let failed = false
let changed = () => {}

export function onTelemetryChange(fn: () => void) {
  changed = fn
}
export function resetNodeTelemetry() {
  epoch++
  at = 0
  series = []
  failed = false
  pending = null
}
export function loadNodeTelemetry(): Promise<void> {
  if (pending) return pending
  if (S.page !== 'dashboard' || S.view !== 'large' || !S._loaded || document.hidden) return Promise.resolve()
  if (Date.now() - at < 60_000) return Promise.resolve()
  const request = epoch
  const job = (async () => {
    at = Date.now()
    try {
      if (!(await hasMetricStore())) {
        if (request === epoch) series = []
        return
      }
      const rows = await queryMetrics(['net.in.rate', 'net.out.rate'], { hours: 1, max: 48 })
      const ids = new Set(visible().map(n => n.uuid))
      if (request !== epoch) return
      series = rows.filter(s => ids.has(s.entity_id))
      failed = false
    } catch {
      if (request === epoch) failed = true
    }
  })().finally(() => {
    if (pending === job) pending = null
    if (request === epoch && S.page === 'dashboard' && S.view === 'large') changed()
  })
  pending = job
  return job
}

export function throughputTrace(uuid: string, now = Date.now()): string {
  const rows = series.filter(s => s.entity_id === uuid)
  const values = rows
    .flatMap(s => (s.points || []).map(p => p.value))
    .filter(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)
  if (!values.length) return '<span class="net-history-empty">1H 暂无网速历史</span>'
  const start = now - 3_600_000,
    max = Math.max(1, ...values)
  const paths = rows
    .map(s => {
      let pen = false,
        d = '',
        last = 0
      for (const p of [...(s.points || [])].sort((a, b) => +new Date(a.time) - +new Date(b.time))) {
        const t = +new Date(p.time),
          v = p.value
        if (
          !Number.isFinite(t) ||
          t < start ||
          t > now + 60_000 ||
          v == null ||
          !Number.isFinite(v) ||
          v < 0
        ) {
          pen = false
          continue
        }
        if (t - last > 180_000) pen = false
        d +=
          (pen ? 'L' : 'M') +
          (((t - start) / 3_600_000) * 200).toFixed(1) +
          ',' +
          (24 - (v / max) * 21).toFixed(1)
        pen = true
        last = t
      }
      return `<path class="${s.metric_key === 'net.out.rate' ? 'trace-up' : 'trace-down'}" d="${d}"/>`
    })
    .join('')
  return `<svg viewBox="0 0 200 26" preserveAspectRatio="none" role="img" aria-label="最近一小时网速，紫色上传、青色下载${failed ? '，更新失败保留旧样本' : ''}">${paths}</svg><span class="net-history-label">1H${failed ? ' · 旧样本' : ''}</span>`
}
