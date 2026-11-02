/* Seed the behaviour tracks with the last hour of stored CPU (metric store,
   Komari ≥ 1.2.6), so monitor curves and the idle / alert timers are right as
   soon as a scene opens. At most once every ten minutes; older servers simply
   start from the live samples. */
import { hasMetricStore, queryMetrics } from '../api/client'
import { seed } from './behavior'

let seededAt = 0
let pending: Promise<void> | null = null

export function seedHistory(): Promise<void> {
  if (pending) return pending
  const now = Date.now()
  if (now - seededAt < 10 * 60_000) return Promise.resolve()
  pending = (async () => {
    if (!(await hasMetricStore())) return
    seededAt = now
    try {
      const ss = await queryMetrics(['cpu.usage'], { hours: 1, max: 60 })
      ss.forEach(s => {
        const buckets = new Map<number, number[]>()
        ;(s.points || []).forEach(p => {
          const t = +new Date(p.time)
          if (!Number.isFinite(t) || !Number.isFinite(p.value)) return
          const at = Math.floor(t / 60_000) * 60_000
          if (!buckets.has(at)) buckets.set(at, [])
          buckets.get(at).push(p.value)
        })
        const pts = [...buckets.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([at, vs]) => [at, vs.reduce((a, b) => a + b, 0) / vs.length] as [number, number])
        if (s.entity_id) seed(s.entity_id, pts, now)
      })
    } catch (e) {
      seededAt = 0
    }
  })().finally(() => {
    pending = null
  })
  return pending
}
