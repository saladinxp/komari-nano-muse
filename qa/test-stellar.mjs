import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'
const source = f =>
  ts.transpileModule(
    fs
      .readFileSync(f, 'utf8')
      .replace(/^import[\s\S]*?from '[^']+'\n/gm, '')
      .replace(/^export \{[\s\S]*?\}\n/gm, '')
      .replace(/^export /gm, ''),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
  ).outputText
const S = {
  nodes: [],
  live: {},
  online: new Set(),
  lastSync: new Date(),
  ts: {},
  page: 'dashboard',
  view: 'large',
  _loaded: true,
  echo: { entries: {} },
}
const common = {
  S,
  Date,
  Set,
  Map,
  document: { hidden: false },
  visible: () => S.nodes,
  store: { get: (k, d) => d },
  pct: (a, b) => (b ? (a / b) * 100 : 0),
  validDate: v => (v ? new Date(v) : null),
}
const c = vm.createContext(common)
vm.runInContext(
  source('src/utils/metrics.ts') + '\n' + source('src/utils/usage.ts') + '\n' + source('src/nodes/list.ts'),
  c,
)
S.nodes = [
  { uuid: 'a', name: 'Node 10', weight: 1, expired_at: '2027-01-01' },
  { uuid: 'b', name: 'Node 2', weight: 0, expired_at: '2027-02-01' },
  { uuid: 'c', name: 'Missing', weight: 3 },
]
S.online = new Set(['a', 'b'])
S.live.a = {
  cpu: 90,
  mem_used: 40,
  mem_total: 100,
  disk_used: 20,
  disk_total: 100,
  load1: 4,
  _hasLoad: true,
  up: 50,
  down: 50,
  total_up: 20,
  total_down: 10,
  _hasTraffic: true,
}
S.live.b = {
  cpu: 10,
  mem_used: 80,
  mem_total: 100,
  disk_used: 60,
  disk_total: 100,
  load1: 1,
  _hasLoad: true,
  up: 20,
  down: 30,
  total_up: 40,
  total_down: 10,
  _hasTraffic: true,
}
const ids = by => Array.from(c.sortNodes(S.nodes, by), n => n.uuid)
for (const [by, order] of Object.entries({
  default: ['b', 'a', 'c'],
  name: ['c', 'b', 'a'],
  cpu: ['a', 'b', 'c'],
  ram: ['b', 'a', 'c'],
  disk: ['b', 'a', 'c'],
  load: ['a', 'b', 'c'],
  speed: ['a', 'b', 'c'],
  traffic: ['b', 'a', 'c'],
  expiry: ['a', 'b', 'c'],
}))
  assert.deepEqual(ids(by), order, by)
S.live.a._hasLoad = false
assert.deepEqual(ids('load'), ['b', 'a', 'c'], 'missing load sorts last rather than as zero')
const partial = c.flat({ load: { load1: 2 }, connections: { tcp: 0 } })
assert.equal(partial._hasLoad, false)
assert.equal(partial._hasConnections, false)
assert.equal(partial._hasCpu, false)
assert.equal(partial._hasMemory, false)
assert.equal(partial._hasNetwork, false)
assert.equal(c.flat({ cpu: { usage: 0 } })._hasCpu, true, 'reported CPU zero is valid')

let queries = 0,
  release,
  notifications = 0
const h = vm.createContext({
  ...common,
  hasMetricStore: async () => true,
  queryMetrics: () => {
    queries++
    return new Promise(r => (release = r))
  },
})
vm.runInContext(source('src/nodes/telemetry.ts'), h)
h.onTelemetryChange(() => notifications++)
const first = h.loadNodeTelemetry(),
  same = h.loadNodeTelemetry()
assert.equal(first, same)
await new Promise(setImmediate)
const at = new Date().toISOString()
release([
  {
    entity_id: 'a',
    metric_key: 'net.in.rate',
    points: [
      { time: at, value: 0 },
      { time: at, value: null },
    ],
  },
  { entity_id: 'hidden', metric_key: 'net.in.rate', points: [{ time: at, value: 1000 }] },
])
await first
assert.equal(queries, 1)
assert.equal(notifications, 1)
assert.match(h.throughputTrace('a'), /<svg/, 'known zero is a valid history')
assert.match(h.throughputTrace('hidden'), /暂无/, 'hidden nodes excluded')
await h.loadNodeTelemetry()
assert.equal(queries, 1, 'one batch per minute')
h.resetNodeTelemetry()
const old = h.loadNodeTelemetry()
await new Promise(setImmediate)
h.resetNodeTelemetry()
release([{ entity_id: 'a', metric_key: 'net.in.rate', points: [{ time: at, value: 99 }] }])
await old
assert.match(h.throughputTrace('a'), /暂无/, 'reset discards late response')
S.page = 'duty'
await h.loadNodeTelemetry()
assert.equal(queries, 2, 'no hidden view request')
console.log(
  'Stellar: nine sorts, missing fields, zero histories, one shared batch, hidden nodes/views and reset races passed.',
)
