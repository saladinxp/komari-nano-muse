// Live-data fallback: a `common:getNodesLatestStatus` entry (what the page polls when the
// /api/clients socket cannot open) must give the same readings as the socket frame for the same
// report. Field mapping taken from Komari's web/rpc/jsonrpc/common.go (getNodesLatestStatus).
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const mem = new Map()
globalThis.window = globalThis
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { flat, fromLatest, metrics } = await server.ssrLoadModule('/src/utils/metrics.ts')
  const { S } = await server.ssrLoadModule('/src/state.ts')

  /* one agent report, as the socket nests it … */
  const socket = {
    cpu: { usage: 37.5 },
    ram: { total: 8 * 2 ** 30, used: 3 * 2 ** 30 },
    swap: { total: 2 ** 30, used: 2 ** 20 },
    disk: { total: 100 * 2 ** 30, used: 42 * 2 ** 30 },
    network: { up: 1200, down: 34000, totalUp: 5e11, totalDown: 7e11 },
    connections: { tcp: 120, udp: 9 },
    load: { load1: 0.5, load5: 0.4, load15: 0.3 },
    uptime: 86400 * 12,
    process: 141,
    updated_at: '2026-11-01T02:00:00Z',
  }
  /* … and as getNodesLatestStatus flattens it (net_in = network.down, connections = tcp + udp) */
  const latest = {
    client: 'n-1',
    time: '2026-11-01T02:00:00Z',
    cpu: 37.5,
    gpu: 0,
    ram: 3 * 2 ** 30,
    ram_total: 8 * 2 ** 30,
    swap: 2 ** 20,
    swap_total: 2 ** 30,
    load: 0.5,
    load5: 0.4,
    load15: 0.3,
    temp: 0,
    disk: 42 * 2 ** 30,
    disk_total: 100 * 2 ** 30,
    net_in: 34000,
    net_out: 1200,
    net_total_up: 5e11,
    net_total_down: 7e11,
    process: 141,
    connections: 129,
    connections_udp: 9,
    online: true,
    uptime: 86400 * 12,
    ping: {},
  }
  assert.deepEqual(fromLatest(latest), flat(socket), 'same LiveRecord from both sources')

  const node = { uuid: 'n-1', name: 'n', mem_total: 8 * 2 ** 30, disk_total: 100 * 2 ** 30 }
  S.live['n-1'] = fromLatest(latest)
  const m = metrics(node)
  assert.equal(m.ram, 37.5)
  assert.equal(m.disk, 42)
  assert.equal(m.up, 1200)
  assert.equal(m.down, 34000)
  assert.equal(m.tcp, 120)
  assert.equal(m.udp, 9)

  /* missing or junk fields read as zero, never NaN */
  const bare = fromLatest({ cpu: 'x', online: false })
  assert.ok(Object.values(bare).every(v => typeof v !== 'number' || v === 0))
  assert.equal(bare._hasLoad, false)

  /* Downsampled probes: Komari averages latency (-1 per timeout) and loss (0/1) per bucket.
     Bucket raw samples here the same way and check the corrected mean of answered probes. */
  const { unbiasPing } = await server.ssrLoadModule('/src/api/client.ts')
  const buckets = [
    [0.2, 0.2, -1, 0.2, -1], // local TCP probe, 40 % lost: the plain mean is negative
    [52, 48, -1, 50, 50], // 50 ms route, one timeout in five
    [30, 30, 30, 30], // nothing lost
    [-1, -1, -1], // everything lost
  ]
  const at = i => new Date(Date.UTC(2026, 10, 1, 2, i)).toISOString()
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length
  const tags = { task_id: '3' }
  const lossSeries = {
    metric_key: 'ping.loss',
    entity_id: 'n-1',
    tags,
    /* same instants, written in another format: matched by time, not by string */
    points: buckets.map((b, i) => ({
      time: at(i).replace('.000Z', 'Z'),
      value: mean(b.map(v => (v < 0 ? 1 : 0))),
    })),
  }
  const fixed = unbiasPing([
    {
      metric_key: 'ping.latency_ms',
      entity_id: 'n-1',
      tags,
      points: buckets.map((b, i) => ({ time: at(i), value: mean(b) })),
    },
    lossSeries,
    { metric_key: 'ping.latency_ms', entity_id: 'n-2', tags, points: [{ time: at(0), value: -0.28 }] },
  ])
  const lat = fixed[0].points.map(p => p.value)
  assert.ok(Math.abs(lat[0] - 0.2) < 1e-9, 'sub-ms probe back to 0.2 ms, got ' + lat[0])
  assert.ok(Math.abs(lat[1] - 50) < 1e-9, '50 ms route back to 50 ms, got ' + lat[1])
  assert.equal(lat[2], 30)
  assert.equal(lat[3], -1, 'a fully lost bucket stays a timeout')
  assert.equal(fixed[2].points[0].value, -0.28, 'no loss series for that node: left alone')
  assert.equal(fixed[1], lossSeries, 'loss series passed through untouched')

  console.log('Live fallback: polled status maps like a socket frame passed.')
  console.log('Ping buckets: timeout bias removed, raw and fully lost buckets unchanged passed.')
} finally {
  await server.close()
}
