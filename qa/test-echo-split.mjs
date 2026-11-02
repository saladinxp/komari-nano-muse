// 2.1.0-beta.7: default lines and custom targets never mix (user, 2026-11-02).
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

const memory = new Map()
const S = { ts: {} }
const c = vm.createContext({
  S,
  store: { get: (k, d) => memory.get(k) ?? d, set: (k, v) => memory.set(k, v) },
})
vm.runInContext(source('src/nodes/echo-presets.ts'), c)
const ids = list => list.map(t => t.id)
const tasks = [
  { id: 1, name: '北京联通' },
  { id: 2, name: '上海电信' },
  { id: 3, name: 'Cloudflare' },
  { id: 4, name: '回声预设 · 电信 · 河北' },
  { id: 5, name: '回声预设 · 联通 · 河北' },
  { id: 6, name: '回声预设 · 移动 · 河北' },
  { id: 7, name: '回声预设 · Google' },
  { id: 8, name: '回声预设 · 电信 · 北京' }, // old binding left for manual cleanup
  { id: 9, name: 'Google 自建' },
  { id: 10, name: '电信 · 河北' }, // the administrator's own task with a similar name
]

// Default lines not enabled: only theme-created tasks are kept out of the custom view.
assert.deepEqual(ids(c.customTasks(tasks)), [1, 2, 3, 9, 10])
assert.equal(c.isPresetTask({ id: 4, name: 'renamed in the backend' }), false, 'unbound and not theme-named')

// Enabled: bound IDs are default lines even if renamed in the backend.
S.ts = {
  echo_preset_tasks: JSON.stringify({ telecom: 4, unicom: 5, mobile: 6, google: 7 }),
  echo_preset_targets: JSON.stringify({
    telecom: '124.237.177.164',
    unicom: '110.242.74.102',
    mobile: '111.63.65.247',
    google: '8.8.8.8',
  }),
}
assert.equal(c.isPresetTask({ id: 4, name: 'renamed in the backend' }), true)
assert.equal(c.isPresetTask({ id: 8, name: '回声预设 · 电信 · 北京' }), true)
assert.equal(c.isPresetTask({ id: 1, name: '北京联通' }), false)
assert.equal(
  c.isPresetTask({ id: 10, name: '电信 · 河北' }),
  false,
  'only the theme prefix marks a default line',
)
assert.deepEqual(ids(c.customTasks(tasks)), [1, 2, 3, 9, 10], 'custom never shows a default line')

// The visitor's selection narrows custom targets but can never bring a default line back.
memory.set('echo-targets', JSON.stringify([2, 4, 8]))
assert.deepEqual(ids(c.customTasks(tasks)), [2])
memory.set('echo-targets', '[]')
assert.deepEqual(ids(c.customTasks(tasks)), [])
assert.equal(c.hasCustomTasks(tasks), true, 'targets exist, just none selected')
memory.delete('echo-targets')
assert.equal(
  c.hasCustomTasks(tasks.filter(t => t.id >= 4 && t.id <= 8)),
  false,
  'only default lines configured',
)

// The default view itself is unchanged: four rows in fixed order, named by line.
const rows = c.presetRows(tasks, 'a')
assert.deepEqual(JSON.parse(JSON.stringify(rows.map(r => r.name))), [
  '电信 · 河北',
  '联通 · 河北',
  '移动 · 河北',
  'Google',
])
assert.deepEqual(JSON.parse(JSON.stringify(rows.map(r => r.task.id))), [4, 5, 6, 7])

// Detail: zero samples are a waiting state, not an unconfigured task or an empty
// default group. The four default slots and their colours must remain present.
vm.runInContext(source('src/pages/detail.ts'), c)
const noSamples = c.pingLines([], 'a', 'preset')
assert.equal(noSamples.lines.length, 4)
assert.ok(noSamples.lines.every(l => !l.task && l.message))
assert.equal(noSamples.empty, undefined)
const noPoints = tasks.map(t => ({ ...t, pts: [] }))
const waiting = c.pingLines(noPoints, 'a', 'custom')
assert.equal(waiting.lines.length, 5)
assert.ok(waiting.lines.every(l => !l.task && l.message === '等待采样'))
const failed = c.pingLines([{ id: 4, name: 'renamed', pts: [[1, null]], loss: 100 }], 'a', 'preset')
assert.equal(failed.lines[0].task.loss, 100, 'timeouts are evidence, not no samples')
S.ts = {}
assert.match(c.pingLines([], 'a', 'preset').empty, /尚未启用默认四线/)

console.log(
  'Echo split: custom excludes bound and theme-created default lines (renamed or stale), selection cannot re-add them, empty-state distinction and unchanged default rows passed.',
)
