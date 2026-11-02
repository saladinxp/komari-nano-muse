import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const code = ts.transpileModule(
  fs.readFileSync('src/nodes/echo-trend.ts', 'utf8').replace(/^export /gm, ''),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText
const c = vm.createContext({})
vm.runInContext(code, c)
const now = Date.UTC(2026, 10, 1, 12),
  start = now - 3_600_000
const sample = (index, lat, loss = 0) => ({
  t: start + index * 120_000 + 30_000,
  lat,
  loss,
  timeout: lat != null && lat < 0,
})
const task = lat => ({ points: Array.from({ length: 30 }, (_, i) => sample(i, lat)) })
for (const latency of [0, 3, 30, 130, 180, 400, 900]) {
  const cells = c.echoCells(task(latency), now)
  assert.ok(
    cells.every(p => p.quality === 'stable'),
    'stable far lines stay cyan: ' + latency,
  )
  assert.ok(cells.every(p => p.height >= 0.5 && p.height <= 1))
}
assert.equal(c.echoHeight(0), 0.5)
assert.equal(c.echoHeight(10), 0.5)
assert.equal(c.echoHeight(400), 1)
assert.ok(c.echoHeight(180) > c.echoHeight(30), 'same absolute scale distinguishes near and far')
let a = task(30),
  b = task(180)
a.points[10] = sample(10, 180)
assert.equal(
  c.echoCells(a, now)[10].height,
  c.echoCells(b, now)[10].height,
  'identical latency has identical height across rows',
)
assert.equal(c.echoCells(a, now)[10].quality, 'unstable', 'relative spike is amber')
a = task(3)
a.points[10] = sample(10, 5)
assert.equal(c.echoCells(a, now)[10].quality, 'stable', 'small absolute jitter is not a spike')
a = task(30)
a.points[5] = sample(5, 30, 0.25)
assert.equal(c.echoCells(a, now)[5].quality, 'unstable', 'partial loss is amber')
a = task(30)
a.points[0] = sample(0, -1, 1)
let cells = c.echoCells(a, now)
assert.equal(cells[0].quality, 'lost', 'first cell total loss does not depend on a previous height')
assert.equal(cells[0].latency, null)
a.points[1] = sample(1, null, null)
assert.equal(c.echoCells(a, now)[1].quality, 'missing', 'missing is not loss')
a.points[1] = sample(1, null, 0.2)
assert.equal(c.echoCells(a, now)[1].quality, 'missing', 'incomplete partial aggregate is not total loss')
const mixed = { points: [sample(0, 50, 0.5), { ...sample(0, 100), t: start + 60_000 }] }
assert.ok(
  Math.abs(c.echoCells(mixed, now)[0].latency - 250 / 3) < 1e-8,
  'combine answered fractions, not biased mean',
)
const dense = { points: [sample(0, 30)], samples: [sample(0, -1, 1), sample(1, 30)] }
assert.equal(c.echoCells(dense, now)[0].quality, 'lost', 'raw samples win over a decimated trace')
assert.equal(c.echoCellCount(130), 30)
assert.equal(c.echoCellCount(150), 30)
assert.equal(c.echoCellCount(270), 60)
assert.equal(c.echoCellCount(1000), 60)
const svg = c.renderEchoTrend({ points: [sample(0, -1, 1)] }, 135, now)
assert.equal((svg.match(/<path /g) || []).length, 4, 'one path per quality, never a DOM node per cell')
const lost = svg.match(/class="echo-bars-lost" d="([^"]*)"/)[1]
assert.match(lost, / 19.80V22/, 'loss is a bottom tick, not a full bar')
assert.ok(svg.match(/class="echo-bars-missing" d="([^"]+)"/), 'no data has hollow frames')
assert.equal(svg.match(/class="echo-bars-stable" d="([^"]*)"/)[1], '', 'no invented success')
assert.equal(c.echoCells({ points: [] }, now).filter(p => p.quality === 'missing').length, 30)
const failures = Array.from({ length: 3 }, (_, i) => sample(25 + i, -1, 1))
assert.equal(c.echoTimeoutHint({ points: failures, loss: 6.4 }), '最近连续超时')
assert.equal(c.echoTimeoutHint({ points: failures, loss: 100 }), '目标可能不回应 ping')
assert.equal(
  c.echoTimeoutHint({ points: failures.slice(0, 2), loss: 100 }),
  '',
  'do not diagnose from only two observations',
)
console.log(
  'Echo trend: global log scale, far stable lines, relative spikes, partial/total loss, grey gaps, first-cell failure, raw grouping, thin cell density and honest timeout hints passed.',
)
