// 2.1.1 last-24-hours maths (src/utils/day-usage.ts): usage sums with counter resets skipped,
// peaks, weighted averages, honoured aggregation, local day labels — Komari's dashboard rules.
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log('ok', name)
}
const T0 = Date.UTC(2026, 10, 3, 0, 0)
const pts = (values, step = 180e3) =>
  values.map((v, j) => ({ time: new Date(T0 + j * step).toISOString(), value: v, count: 3 }))
const s = (metric_key, entity_id, values, extra = {}) => ({
  metric_key,
  entity_id,
  points: pts(values),
  downsampled: true,
  downsample_algorithm:
    {
      'traffic.up': 'sum',
      'traffic.down': 'sum',
      'net.total.up': 'last',
      'net.total.down': 'last',
      'cpu.usage': 'avg',
      'memory.used': 'avg',
    }[metric_key] || 'p95',
  ...extra,
})

try {
  const D = await server.ssrLoadModule('/src/utils/day-usage.ts')
  const ids = new Set(['a', 'b'])

  await test('usage sums the deltas per node, largest first, with fleet totals', () => {
    const r = D.dayTraffic(
      [
        s('traffic.up', 'a', [10, 20, 30]),
        s('traffic.down', 'a', [1, 2, null]),
        s('traffic.up', 'b', [100, 0, 50]),
        s('traffic.down', 'b', [5, 5, 5]),
        s('traffic.up', 'z', [1e9, 1e9, 1e9]), // filtered out: not in ids
      ],
      ids,
    )
    assert.deepEqual(
      r.nodes.map(n => [n.uuid, n.up, n.down, n.total]),
      [
        ['b', 150, 15, 165],
        ['a', 60, 3, 63],
      ],
    )
    assert.equal(r.up, 210)
    assert.equal(r.down, 18)
  })

  await test('a counter restart (drop, or return after a gap) skips that bucket only', () => {
    const r = D.dayTraffic(
      [
        s('net.total.up', 'a', [1000, 1100, 50, 60, null, 70, 80]),
        s('traffic.up', 'a', [5, 100, 999, 10, null, 888, 10]),
      ],
      ids,
    )
    // bucket 2: counter went down (restart) → 999 is a baseline; bucket 5: back after a gap → 888 skipped
    assert.equal(r.nodes[0].up, 5 + 100 + 10 + 10)
    // a rebound to the old level right after a drop is also a baseline (Komari's rebound rule)
    const q = D.dayTraffic(
      [s('net.total.down', 'b', [500, 20, 600, 610]), s('traffic.down', 'b', [1, 2, 3, 4])],
      ids,
    )
    assert.equal(q.nodes[0].down, 1 + 4)
  })

  await test('peak is the bucket with the highest up + down rate', () => {
    const r = D.dayTraffic(
      [
        s('traffic.up', 'a', [1, 1, 1]),
        s('net.out.rate', 'a', [10, 50, 20]),
        s('net.in.rate', 'a', [100, 30, 90]),
      ],
      ids,
    )
    assert.equal(r.nodes[0].peakRate, 110)
    assert.equal(r.nodes[0].peakTime, T0)
  })

  await test('no usable deltas, or an aggregation the server did not apply → nothing', () => {
    assert.equal(D.dayTraffic([], ids), null)
    assert.equal(D.dayTraffic([s('traffic.up', 'a', [null, null])], ids), null)
    assert.equal(
      D.dayTraffic([s('traffic.up', 'a', [1, 2], { downsample_algorithm: 'avg' })], ids),
      null,
      'an old server averaging deltas would undercount',
    )
    assert.ok(
      D.dayTraffic(
        [s('traffic.up', 'a', [1, 2], { downsampled: false, downsample_algorithm: undefined })],
        ids,
      ),
    )
  })

  await test('averages are weighted by bucket sample counts; memory as percent of mem_total', () => {
    const cpu = s('cpu.usage', 'a', [10, 40])
    cpu.points[0].count = 3
    cpu.points[1].count = 1
    const [x] = D.dayAverage([cpu], 'cpu.usage', ids, (_, v) => v)
    assert.equal(x.value, (10 * 3 + 40) / 4)
    assert.equal(x.peak, 40)
    assert.equal(x.peakTime, T0 + 180e3)
    const mem = D.dayAverage(
      [s('memory.used', 'a', [2, 2]), s('memory.used', 'b', [1, 3])],
      'memory.used',
      ids,
      (u, v) => (u === 'a' ? (v / 4) * 100 : NaN),
    )
    assert.deepEqual(
      mem.map(m => [m.uuid, m.value]),
      [['a', 50]],
      'a node without mem_total is left out',
    )
    assert.deepEqual(
      D.dayAverage(
        [s('cpu.usage', 'a', [5], { downsample_algorithm: 'p95' })],
        'cpu.usage',
        ids,
        (_, v) => v,
      ),
      [],
    )
  })

  await test('peak times read as 今天 / 昨天 / date, in local time', () => {
    const now = new Date(2026, 10, 4, 10, 0).getTime()
    assert.equal(D.dayLabel(new Date(2026, 10, 4, 8, 55).getTime(), now), '今天 08:55')
    assert.equal(D.dayLabel(new Date(2026, 10, 3, 19, 5).getTime(), now), '昨天 19:05')
    assert.equal(D.dayLabel(new Date(2026, 10, 1, 7, 3).getTime(), now), '11-01 07:03')
  })

  await test('the query asks for what the maths needs', () => {
    assert.equal(D.DAY_QUERY.hours, 24)
    assert.equal(D.DAY_QUERY.max, 500, "Komari's default bucket count, so peaks match its panel")
    for (const k of ['traffic.up', 'traffic.down']) assert.equal(D.DAY_QUERY.byMetric[k], 'sum')
    for (const k of D.DAY_KEYS) assert.ok(typeof k === 'string')
  })

  console.log(`day usage: ${passed} checks passed`)
} finally {
  await server.close()
}
