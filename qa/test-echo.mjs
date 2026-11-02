import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'
// Exercise the echo module straight from source: drop imports/exports, transpile the TypeScript, run slices in a VM.
const strip = f => {
  const code = fs
    .readFileSync(f, 'utf8')
    .replace(/^import[\s\S]*?from '[^']+'\n/gm, '')
    .replace(/^export \{[\s\S]*?\}\n/gm, '')
  return ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
}
const source = strip('src/nodes/echo.ts') + '\n' + strip('src/api/client.ts')
const ctx = vm.createContext({})
vm.runInContext(
  source.slice(source.indexOf('function packEcho('), source.indexOf('function echoTarget(')),
  ctx,
)
const now = Date.UTC(2026, 9, 30, 12),
  point = (ms, value) => ({ time: new Date(now + ms).toISOString(), value })
let t = ctx.packEcho(1, 'zero', [point(-1000, 0)], [point(-1000, 0)], now)
assert.equal(t.last.lat, 0)
assert.equal(t.loss, 0)
assert.equal(t.avg, 0)
t = ctx.packEcho(1, 'none', [], [], now)
assert.equal(t.last, null)
assert.equal(t.loss, null)
assert.equal(t.avg, null)
t = ctx.packEcho(1, 'timeout', [point(-2000, 10), point(-1000, -1)], [point(-2000, 0), point(-1000, 1)], now)
assert.equal(t.last.lat, null)
assert.equal(t.last.timeout, true)
assert.equal(t.loss, 50)
assert.equal(t.avg, 10)
t = ctx.packEcho(
  1,
  'window',
  [point(-3700000, 77), point(120000, 99), point(-1000, 22), point(-2000, 11), point(-3000, null)],
  [point(-1000, 1.5)],
  now,
)
assert.equal(t.points.length, 3)
assert.equal(t.last.lat, 22)
assert.equal(t.loss, null)
assert.equal(t.avg, 16.5)
t = ctx.packEcho(1, 'null with explicit loss', [point(-1000, null)], [point(-1000, 1)], now)
assert.equal(t.last.loss, 1)
assert.equal(t.loss, 100)
assert.equal(t.last.lat, null)
t = ctx.packEcho(1, 'gap', [point(-3000, 10), point(-2000, -1), point(-1000, 20)], [point(-2000, 1)], now)
assert.equal(t.samples.filter(p => p.timeout).length, 1, 'keep explicit failed samples for the cell renderer')
t = ctx.packEcho(
  1,
  'offset normal loss',
  [point(-2000, 11), point(-1000, 22)],
  [point(-1999, 0), point(-999, 0)],
  now,
)
assert.equal(t.last.lat, 22)
assert.equal(t.loss, 0)
assert.equal(t.points.length, 2)
assert.equal(t.samples.filter(p => p.lat != null).length, 2)
t = ctx.packEcho(
  1,
  'missing latency sample',
  [point(-3000, 10), point(-2000, null), point(-1000, 20)],
  [],
  now,
)
assert.equal(t.points.length, 3)
assert.equal(
  t.samples.filter(p => p.hasLatency && p.lat == null).length,
  1,
  'missing latency stays explicit rather than interpolated',
)
t = ctx.packEcho(
  1,
  'dense',
  Array.from({ length: 1000 }, (_, i) => point(-2000000 + i * 2000, i)),
  [],
  now,
)
assert.equal(t.points.length, 96)
assert.equal(t.samples.length, 1000, 'trend cells retain every original sample before grouping')
assert.equal(t.last.lat, 999)
assert.equal(t.avg, 499.5)
console.log(
  'Echo aggregation: zero, missing data, timeouts, time window, explicit loss and chart gaps passed.',
)
;(async () => {
  let queries = 0,
    definitions = 0,
    visibleNodes = [{ uuid: 'a' }, { uuid: 'b' }],
    scope = [visibleNodes[0]]
  const state = {
    echo: { entries: {}, pending: null, epoch: 0 },
    page: 'dashboard',
    view: 'list',
    _loaded: true,
  }
  const loader = vm.createContext({
    S: state,
    resetPingTasks: () => {},
    Date,
    Set,
    Number,
    Object,
    Promise,
    document: { hidden: false },
    resetNodeTelemetry: () => {},
    filtered: () => scope,
    visible: () => visibleNodes,
    renderEchoBodies: () => {},
    setEchoTaskDefs: () => {},
    updateEchoCaption: () => {},
    hasMetricStore: async () => true,
    pingTasks: async () => {
      definitions++
      return [{ id: 1, name: 'Probe', interval: 300 }]
    },
    queryMetrics: async () => {
      queries++
      return ['a', 'b', 'hidden'].flatMap(id => [
        {
          entity_id: id,
          metric_key: 'ping.latency_ms',
          interval_seconds: 60,
          tags: { task_id: '1' },
          points: [{ time: new Date().toISOString(), value: 12 }],
        },
        {
          entity_id: id,
          metric_key: 'ping.loss',
          tags: { task_id: '1' },
          points: [{ time: new Date().toISOString(), value: 0 }],
        },
      ])
    },
  })
  vm.runInContext(
    source.slice(source.indexOf('function packEcho('), source.indexOf('function echoTarget(')),
    loader,
  )
  vm.runInContext(
    source.slice(source.indexOf('async function pmap('), source.indexOf('async function loadPublic(')),
    loader,
  )
  vm.runInContext(
    source.slice(source.indexOf('function resetEcho('), source.indexOf('function bindEcho(')),
    loader,
  )
  await loader.loadEcho()
  assert.equal(queries, 1)
  assert.equal(definitions, 1)
  assert.ok(state.echo.entries.a)
  assert.ok(state.echo.entries.b)
  assert.equal(state.echo.entries.a.tasks[0].interval, 300, 'task cadence reaches the renderer')
  assert.equal(state.echo.entries.a.tasks[0].bucketSeconds, 60, 'metric bucket duration is preserved')
  assert.equal(state.echo.entries.hidden, undefined)
  scope = [visibleNodes[1]]
  await loader.loadEcho()
  assert.equal(queries, 1, 'Filter switches use the fresh bulk cache')
  state.page = 'detail'
  await loader.loadEcho(true)
  assert.equal(queries, 1, 'Hidden echo view makes no request')
  state.page = 'dashboard'
  let release
  loader.queryMetrics = () => {
    queries++
    return new Promise(r => (release = r))
  }
  const pending = loader.loadEcho(true)
  await new Promise(setImmediate)
  await loader.loadEcho(true)
  assert.equal(queries, 2, 'Concurrent echo requests deduplicate')
  loader.resetEcho()
  release([])
  await pending
  assert.equal(Object.keys(state.echo.entries).length, 0, 'Late results cannot repopulate reset cache')
  visibleNodes = [{ uuid: 'a' }, { uuid: 'b' }, { uuid: 'c' }, { uuid: 'd' }]
  scope = visibleNodes
  let active = 0,
    maxActive = 0
  loader.hasMetricStore = async () => false
  loader.getJson = async () => {
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise(setImmediate)
    active--
    throw new Error('probe offline')
  }
  await loader.loadEcho(true)
  assert.equal(maxActive, 2, 'Legacy fallback concurrency stays at two')
  assert.ok(state.echo.entries.a.error)
  assert.equal(state.echo.entries.a.tasks.length, 0)
  state.echo.entries.a = { at: 0, configured: true, tasks: [{ id: 1, name: 'Previous' }] }
  await loader.loadEcho(true)
  assert.equal(state.echo.entries.a.tasks[0].name, 'Previous', 'A failed refresh retains the prior samples')
  console.log(
    'Echo loader: bulk cache, scope, hidden view, deduplication, reset race, bounded legacy fallback and retained samples passed.',
  )
})().catch(e => {
  console.error(e)
  process.exitCode = 1
})
