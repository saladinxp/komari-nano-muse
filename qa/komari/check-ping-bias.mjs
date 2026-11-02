// Compares Komari's downsampled ping buckets with the truth behind them, before and after the
// theme's correction (api/client.ts unbiasPing). The truth comes from Komari's own per-minute
// rollups in metrics.db (opened read-only): answered mean = (latency sum + timeouts) / (count −
// timeouts), since each timeout is stored as -1 next to a loss of 1. Needs a node with partial
// loss (reporter.py's Seoul 05) and a few minutes of data.
// Usage: node --no-warnings qa/komari/check-ping-bias.mjs http://127.0.0.1:25774 <state>/clients.json <run>/metrics.db [points=30]
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'vite'

globalThis.window = globalThis
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
const [base, clientsFile, dbFile, pts = '30'] = process.argv.slice(2)
const uuid = JSON.parse(readFileSync(clientsFile, 'utf8')).find(c => c.name === 'Seoul 05').uuid

/* per-minute rollups: task → bucket start (ms) → { n, sum, lost } */
const db = new DatabaseSync(dbFile, { readOnly: true })
const minutes = {}
for (const r of db
  .prepare(
    `select s.metric_name m, s.tags tags, r.bucket_milli b, r.count n, r.sum sum
       from metric_rollups r join metric_series s on s.id = r.series_id
      where s.entity_id = ? and s.metric_name in ('ping.latency_ms', 'ping.loss')`,
  )
  .all(uuid)) {
  const task = JSON.parse(r.tags).task_id,
    m = ((minutes[task] ||= {})[r.b] ||= { n: 0, sum: 0, lost: 0 })
  if (r.m === 'ping.loss') m.lost = r.sum
  else Object.assign(m, { n: r.n, sum: r.sum })
}
db.close()

const rpc = async (method, params) =>
  (
    await (
      await fetch(base + '/api/rpc2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
    ).json()
  ).result
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
let worst = 0
try {
  const { unbiasPing } = await server.ssrLoadModule('/src/api/client.ts')
  const down = await rpc('public:queryMetrics', {
    metric_keys: ['ping.latency_ms', 'ping.loss'],
    entity_id: uuid,
    hours: 1,
    max_points: +pts,
  })
  const fixed = unbiasPing(down.series)
  for (const task of Object.keys(minutes).sort()) {
    const of = (ss, k) => ss.find(s => s.metric_key === k && s.tags && s.tags.task_id === task)
    const d = of(down.series, 'ping.latency_ms'),
      f = of(fixed, 'ping.latency_ms'),
      step = (d.interval_seconds || 60) * 1000
    console.log(`task ${task}: bucket ${d.interval_seconds}s, downsampled=${d.downsampled}`)
    ;(d.points || []).forEach((p, i) => {
      if (p.value == null) return
      /* a bucket is stamped with its start: it holds the minutes starting in [t, t + step) */
      const t = +new Date(p.time),
        inside = Object.entries(minutes[task]).filter(([b]) => +b >= t && +b < t + step),
        n = inside.reduce((a, [, m]) => a + m.n, 0),
        lost = inside.reduce((a, [, m]) => a + m.lost, 0),
        sum = inside.reduce((a, [, m]) => a + m.sum, 0),
        truth = n > lost ? (sum + lost) / (n - lost) : null
      if (truth != null) worst = Math.max(worst, Math.abs(f.points[i].value - truth))
      console.log(
        `  ${p.time.slice(11, 19)}  ${n} probes ${lost} lost   komari ${p.value.toFixed(2)}   corrected ${f.points[i].value.toFixed(2)}   truth ${truth == null ? '—' : truth.toFixed(2)}`,
      )
    })
  }
} finally {
  await server.close()
}
console.log('largest |corrected − truth|:', worst.toFixed(6), 'ms')
