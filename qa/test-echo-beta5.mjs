import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'
const source = f =>
  ts.transpileModule(
    fs
      .readFileSync(f, 'utf8')
      .replace(/^import[\s\S]*?from '[^']+'\n/gm, '')
      .replace(/^export /gm, ''),
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    },
  ).outputText
const S = { ts: {} },
  c = vm.createContext({ S })
vm.runInContext(source('src/nodes/echo-presets.ts'), c)
const plain = v => JSON.parse(JSON.stringify(v))
const targets = plain(c.configuredPresets())
assert.deepEqual(
  targets.map(t => t.target),
  ['124.237.177.164', '110.242.74.102', '111.63.65.247', '8.8.8.8'],
)
assert.equal(c.requiresPresetVerification(targets), false, 'built-in user-selected targets need no checkbox')
const oldTargets = ['219.141.136.10', '202.106.0.20', '221.179.155.161', '8.8.8.8']
const tasks = targets.map((p, i) => ({
  id: i + 1,
  name: '回声预设 · ' + p.name.replace('河北', '北京'),
  target: oldTargets[i],
  type: 'icmp',
  default_on: true,
  interval: 60,
  clients: ['a'],
}))
const ids = Object.fromEntries(targets.map((p, i) => [p.key, i + 1]))
S.ts = { echo_preset_tasks: JSON.stringify(ids) }
let rows = c.presetRows(tasks, 'a')
assert.deepEqual(
  plain(rows.slice(0, 3).map(r => [r.message, !!r.task])),
  Array(3).fill(['待管理员更新目标', false]),
)
assert.equal(rows[3].task.id, 4, 'unchanged Google keeps its data')
const plan = plain(c.presetPlan([{ uuid: 'a' }], tasks, targets))
assert.deepEqual(
  plan.map(p => p.reuseId),
  [null, null, null, 4],
)
assert.deepEqual(
  plan.map(p => p.oldId),
  [1, 2, 3, 4],
)
assert.deepEqual(
  plan.map(p => p.oldTarget),
  oldTargets,
)
const explicit = Object.fromEntries(targets.map((p, i) => [p.key, oldTargets[i]]))
S.ts.echo_preset_targets = JSON.stringify(explicit)
rows = c.presetRows(tasks, 'a')
assert.deepEqual(
  plain(rows.map(r => r.task.id)),
  [1, 2, 3, 4],
  'beta.4 explicit targets retain their bindings',
)
assert.deepEqual(
  plain(rows.map(r => r.name)),
  ['电信', '联通', '移动', 'Google'],
  'custom targets never inherit the Hebei province',
)
assert.equal(c.requiresPresetVerification(c.configuredPresets()), true)
S.ts.echo_preset_targets = JSON.stringify({ google: '8.8.8.8' })
assert.ok(
  c
    .presetRows(tasks, 'a')
    .slice(0, 3)
    .every(r => r.message === '待管理员更新目标'),
  'partial saved records cannot silently relabel old IDs',
)
S.ts = {}
const original = JSON.stringify(tasks),
  calls = []
const call = async (method, params) => {
  calls.push({ method, params })
  return { task_id: 10 + calls.length }
}
const bindings = await c.ensureDefaultTasks([{ uuid: 'a' }], tasks, call)
assert.equal(calls.length, 3)
assert.equal(bindings.google, 4)
assert.ok(
  calls.every(c => c.method === 'admin:addPingTask' && c.params.interval === 60 && c.params.default_on),
)
assert.deepEqual(
  JSON.parse(JSON.stringify(tasks.slice(0, 4))),
  JSON.parse(original),
  'all old tasks stay identical',
)
await c.ensureDefaultTasks([{ uuid: 'a' }], tasks, call)
assert.equal(calls.length, 3, 'repeated enable is idempotent')
for (const target of oldTargets.slice(0, 2))
  await assert.rejects(
    () => c.ensureDefaultTasks([{ uuid: 'a' }], [], call, [{ ...targets[0], target }, ...targets.slice(1)]),
    /已失效地址/,
  )
const custom = targets.map(p => (p.key === 'mobile' ? { ...p, target: oldTargets[2], name: '移动' } : p))
assert.equal(
  c.requiresPresetVerification(custom),
  true,
  'old mobile is allowed as an explicitly verified custom target',
)
await c.ensureDefaultTasks([{ uuid: 'a' }], [], call, custom)
for (const key of ['telecom', 'unicom', 'mobile'])
  assert.equal(c.presetName(key, '192.0.2.1').includes('河北'), false)
for (const [name, short] of [
  ['回声预设 · 电信 · 河北', '电信 · 河北'],
  ['回声预设 · 联通 · 河北', '联通 · 河北'],
  ['回声预设 · 移动 · 河北', '移动 · 河北'],
  ['回声预设 · Google', 'Google'],
  ['其他 · 电信', '其他 · 电信'],
])
  assert.equal(c.echoTaskName(name), short)

const trend = vm.createContext({})
vm.runInContext(source('src/nodes/echo-trend.ts'), trend)
const now = Date.UTC(2026, 10, 1, 12, 10, 37),
  start = now - 3600000
const cadenceTask = (interval, begin = start) => ({
  interval,
  bucketSeconds: 60,
  points: Array.from({ length: Math.floor((now - begin) / 1000 / interval) }, (_, i) => ({
    t: Math.floor((begin + i * interval * 1000) / 60000) * 60000,
    lat: 180,
    loss: 0,
  })),
})
for (const width of [119, 157, 229, 300, 800]) {
  const task = cadenceTask(300),
    count = trend.echoCellCount(width, 300),
    cells = trend.echoCells(task, now, count)
  assert.equal(count, 12)
  assert.equal(
    cells.filter(c => c.quality === 'missing').length,
    0,
    '300s cadence has no phantom gaps at width ' + width,
  )
  assert.ok(cells.every(c => c.quality === 'stable' || c.quality === 'pending'))
  const svg = trend.renderEchoTrend(task, width, now)
  assert.equal((svg.match(/<path /g) || []).length, 4)
  assert.ok(Number(svg.match(/stroke-width="([^"]+)/)[1]) <= 3)
}
const recent = cadenceTask(300, now - 12 * 60000)
let cells = trend.echoCells(recent, now, 12)
assert.ok(
  cells.slice(0, 8).every(c => c.quality === 'missing'),
  'before a task starts is genuinely unknown',
)
const gap = cadenceTask(300)
gap.points.splice(6, 1)
assert.equal(
  trend.echoCells(gap, now, 12).filter(c => c.quality === 'missing').length,
  1,
  'a missed long-interval observation stays grey',
)
const right = {
  interval: 60,
  bucketSeconds: 60,
  points: [{ t: Math.floor(now / 60000) * 60000 - 60000, lat: 180, loss: 0 }],
}
cells = trend.echoCells(right, now, 60)
assert.equal(
  cells.at(-1).quality,
  'pending',
  'fresh midpoint evidence leaves the unfinished right edge blank',
)
assert.equal(cells.at(-2).quality, 'stable')
assert.equal(
  trend.echoCells(right, now + 180000, 60).at(-1).quality,
  'missing',
  'an overdue right edge is real missing data',
)
const current = { ...right, points: [{ t: now - 5000, lat: 0, loss: 0 }] }
assert.equal(
  trend.echoCells(current, now, 60).at(-1).quality,
  'stable',
  'a returned partial current bucket is kept',
)
current.points.push({ t: now - 1000, lat: null, loss: null })
current.points.shift()
assert.equal(
  trend.echoCells(current, now, 60).at(-1).quality,
  'missing',
  'a returned unknown bucket stays grey',
)
assert.equal(
  trend.echoCells({ interval: 300, points: [] }, now, 12).filter(c => c.quality === 'missing').length,
  12,
)
assert.equal(trend.echoCellCount(800, 7200), 1)
assert.equal(trend.echoCellCount(800, 0), 60)
console.log(
  'Echo beta.5: user-selected defaults, beta.3 migration, beta.4 explicit targets, immutable plans, rejected old addresses, honest names, 300s cadence, bucket midpoint and right-edge waiting passed.',
)
