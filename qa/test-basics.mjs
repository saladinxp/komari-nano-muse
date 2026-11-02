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

const S = { live: {}, online: new Set(), ts: {}, nodes: [] }
const c = vm.createContext({
  S,
  pct: (a, b) => (b ? (a / b) * 100 : 0),
  esc: String,
  fB: String,
  document: { querySelectorAll: () => [] },
})
vm.runInContext(source('src/utils/metrics.ts') + '\n' + source('src/utils/usage.ts'), c)
const node = { uuid: 'a', traffic_limit: 100, traffic_limit_type: 'sum' }
assert.equal(c.usageOf(node).known, false)
S.live.a = c.flat({ cpu: { usage: 1 }, network: { up: 1, down: 2 } })
assert.equal(c.usageOf(node).known, false, 'absent counters do not become zero')
S.live.a = c.flat({ cpu: { usage: 1 }, network: { totalUp: 0, totalDown: 0 } })
assert.equal(c.usageOf(node).used, 0, 'reported zero is valid')
assert.equal(c.usageOf(node).remaining, 100)
S.live.a = c.fromLatest({ net_total_up: 30, net_total_down: 80 })
for (const [mode, used] of Object.entries({ sum: 110, up: 30, down: 80, max: 80, min: 30 })) {
  node.traffic_limit_type = mode
  assert.equal(c.usageOf(node).used, used)
}
node.traffic_limit_type = 'sum'
assert.equal(c.usageOf(node).over, 10)
assert.equal(c.usageOf(node).remaining, 0)
assert.equal(c.usageOf(node).stale, true)
node.traffic_limit = 0
assert.equal(c.usageOf(node).limit, null)
assert.match(c.usageContent(node), /未设配额/)
node.traffic_limit = 100
node.traffic_limit_type = 'unsupported'
assert.equal(c.usageOf(node).used, null)
assert.match(c.usageContent(node), /—/)
S.live.a = c.flat({ cpu: { usage: 1 }, network: { totalUp: -1, totalDown: 20 } })
assert.equal(c.usageOf(node).known, false)

const memory = new Map(),
  preset = vm.createContext({
    S,
    store: { get: (k, d) => memory.get(k) ?? d, set: (k, v) => memory.set(k, v) },
  })
vm.runInContext(source('src/nodes/echo-presets.ts'), preset)
assert.equal(preset.echoGroup(), 'custom', 'existing sites keep their custom targets')
memory.set('echo-targets', '[]')
assert.equal(preset.filterCustomTasks([{ id: 1 }]).length, 0)
memory.delete('echo-targets')
assert.equal(preset.filterCustomTasks([{ id: 1 }]).length, 1)
const targets = [
  { key: 'telecom', name: '电信 · 河北', target: '124.237.177.164' },
  { key: 'unicom', name: '联通 · 河北', target: '110.242.74.102' },
  { key: 'mobile', name: '移动 · 河北', target: '111.63.65.247' },
  { key: 'google', name: 'Google', target: '8.8.8.8' },
]
const tasks = [{ id: 7, type: 'icmp', target: targets[0].target, default_on: true, clients: ['a', 'b'] }]
const originals = JSON.stringify(tasks),
  calls = []
const call = async (method, params) => {
  calls.push({ method, params })
  const task = { ...params, id: 10 + calls.length }
  tasks.push(task)
  return { task_id: task.id }
}
const bindings = await preset.ensureDefaultTasks([{ uuid: 'a' }, { uuid: 'b' }], tasks, call, targets)
assert.equal(bindings.telecom, 7)
assert.equal(calls.length, 3)
assert.equal(
  JSON.stringify(tasks[0]),
  JSON.stringify(JSON.parse(originals)[0]),
  'existing tasks stay untouched',
)
assert.ok(
  calls.every(c => c.params.interval === 60 && c.params.default_on && c.params.clients.join(',') === 'a,b'),
)
await preset.ensureDefaultTasks([{ uuid: 'a' }, { uuid: 'b' }], tasks, call, targets)
assert.equal(calls.length, 3, 'repeated enable reuses tasks')
await assert.rejects(
  () => preset.ensureDefaultTasks([{ uuid: 'a' }], [], async () => ({}), targets),
  /有效任务编号/,
)
S.ts.echo_preset_tasks = JSON.stringify(bindings)
S.ts.echo_preset_targets = JSON.stringify(Object.fromEntries(targets.map(p => [p.key, p.target])))
assert.equal(preset.echoGroup(), 'preset')
assert.equal(preset.presetRows([], 'a').length, 4)
assert.equal(preset.presetRows([{ id: 7, name: 'custom name' }], 'a')[0].task.name, '电信 · 河北')

const t = vm.createContext({ S, store: { get: (k, d) => d }, visible: () => [], Date, Set, Map })
vm.runInContext(source('src/pages/traffic.ts'), t)
const at = new Date().toISOString(),
  series = [
    { entity_id: 'a', metric_key: 'net.in.rate', points: [{ time: at, value: 0 }] },
    { entity_id: 'b', metric_key: 'net.in.rate', points: [{ time: at, value: 20 }] },
    { entity_id: 'c', metric_key: 'net.in.rate', points: [{ time: at, value: null }] },
    { entity_id: 'hidden', metric_key: 'net.in.rate', points: [{ time: at, value: 999 }] },
  ]
let totals = t.aggregateThroughput(series, new Set(['a', 'b', 'c']), 'net.in.rate')
assert.equal(totals[0].value, 20)
assert.equal(totals[0].contributors, 2, 'unknown samples are excluded, known zero contributes')
assert.equal(
  t.aggregateThroughput([series[2]], new Set(['c']), 'net.in.rate')[0].value,
  null,
  'a fully missing bucket stays a chart gap',
)

let release,
  queries = 0,
  seeds = 0
const h = vm.createContext({
  hasMetricStore: async () => true,
  queryMetrics: () => {
    queries++
    return new Promise(r => (release = r))
  },
  seed: () => seeds++,
})
vm.runInContext(source('src/cast/history.ts'), h)
const first = h.seedHistory(),
  second = h.seedHistory()
assert.equal(first, second)
await new Promise(setImmediate)
release([{ entity_id: 'a', points: [{ time: at, value: 2 }] }])
await first
await h.seedHistory()
assert.equal(queries, 1)
assert.equal(seeds, 1)
console.log(
  'Basics: missing/zero/offline counters, five quota modes, overage, task reuse, custom selection, history sums and shared CPU seeding passed.',
)

// Every seated character uses the keyboard landmark, across all 27 desk positions.
const seat = vm.createContext({})
vm.runInContext(
  source('src/cast/desk.ts') +
    '\n' +
    source('src/pages/duty/layout.ts') +
    '\n' +
    `
  for (const room of Object.values(ROOM_TYPES)) for (const d of room.desks) for (const s of Object.values(DESK_CAST)) {
    const p = keyboardSeat(s, d.size, d.screen), a = anchor(s, s.frames[0])
    if (!(p.k > 0)) throw Error('invalid seat scale')
    if (Math.abs(p.x + (s.hand.x-a.x)*p.k - (d.screen.x+d.screen.w*.42)) > 1e-6) throw Error('hand x')
    if (Math.abs(p.y + (s.hand.y-a.y)*p.k - (d.screen.y+d.screen.h*1.55)) > 1e-6) throw Error('hand y')
    if (p.y + (s.frames[0][1]-a.y)*p.k < d.screen.y+d.screen.h*.56-1e-6) throw Error('head covers screen labels')
  }
`,
  seat,
)
console.log(
  'Seats: eight characters × 27 desks across three room types reach keyboard landmarks and preserve screen labels.',
)

const manifest = JSON.parse(fs.readFileSync('komari-theme.json', 'utf8'))
const fields = manifest.configuration.data
assert.equal(
  fields.find(f => f.key === 'echo_preset_tasks').type,
  'string',
  'association uses the supported managed string type',
)
assert.equal(
  new Set(fields.map(f => f.key).filter(Boolean)).size,
  fields.filter(f => f.key).length,
  'no duplicate setting keys',
)
