// 2.1.0-beta.7 latency smoothing: no invented values, no hidden spikes, no overshoot.
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
import ts from 'typescript'
const code = ts.transpileModule(fs.readFileSync('src/charts/smooth.ts', 'utf8').replace(/^export /gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText
const c = vm.createContext({})
vm.runInContext(
  code +
    '\nthis.thin = thin; this.monotoneSegments = monotoneSegments; this.calm = calm; this.smoothPoints = smoothPoints',
  c,
)

// 400 one-minute samples: gentle jitter, one 450 ms spike, one 0 ms dip.
let seed = 3
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const raw = Array.from({ length: 400 }, (_, i) => [
  i * 60000,
  i === 217 ? 450 : i === 90 ? 0 : 140 + rnd() * 6,
])
const kept = c.thin(raw, 120)
assert.equal(kept.length, 120)
assert.deepEqual(JSON.parse(JSON.stringify([kept[0], kept.at(-1)])), [raw[0], raw.at(-1)], 'endpoints kept')
const set = new Set(raw.map(p => p.join()))
assert.ok(
  kept.every(p => set.has(p.join())),
  'only real samples, nothing averaged',
)
assert.ok(
  kept.some(p => p[1] === 450),
  'the spike survives thinning',
)
assert.ok(
  kept.some(p => p[1] === 0),
  'the dip survives thinning',
)
assert.ok(
  kept.every((p, i) => !i || p[0] > kept[i - 1][0]),
  'time order kept',
)
assert.equal(c.thin(raw.slice(0, 50), 120).length, 50, 'sparse data is left alone')

// Two nearby jumps can land in one LTTB bucket. Preserve both raw heights and
// their adjacent baseline samples, even on a phone where the vertex budget is small.
for (const keep of [20, 80, 120]) {
  for (const start of [1, 90, 217, 397]) {
    const close = Array.from({ length: 400 }, (_, i) => [
      i * 60000,
      i === start ? 450 : i === start + 1 ? 350 : 100,
    ])
    const result = c.smoothPoints(close, keep)
    for (const i of [start - 1, start, start + 1, start + 2])
      assert.ok(
        result.some(p => p[0] === close[i][0] && p[1] === close[i][1]),
        'close spikes kept exactly',
      )
    assert.ok(result.length <= close.length, 'bounded by original samples')
  }
  const stepRaw = Array.from({ length: 400 }, (_, i) => [i, i < 193 ? 40 : 160])
  const result = c.smoothPoints(stepRaw, keep)
  assert.ok(
    result.some(p => p[0] === 192 && p[1] === 40),
    'last point before a step is exact',
  )
  assert.ok(
    result.some(p => p[0] === 193 && p[1] === 160),
    'first point after a step is exact',
  )
}

// calm(): jitter evened out, spikes and dips exact, nothing outside the samples' range.
const vals = raw.map(p => p[1])
const calmed = c.calm(vals)
assert.equal(calmed[217], 450, 'spike kept exactly')
assert.equal(calmed[90], 0, 'dip kept exactly')
assert.ok(
  [215, 216, 218, 219].every(i => calmed[i] < 150),
  'a spike never bleeds into its neighbours',
)
const spread = a => {
  const q = a.filter((_, i) => Math.abs(i - 217) > 4 && Math.abs(i - 90) > 4)
  return Math.max(...q) - Math.min(...q)
}
assert.ok(spread(calmed) < spread(vals) * 0.7, `jitter reduced: ${spread(calmed)} vs ${spread(vals)}`)
assert.ok(
  calmed.every(v => v >= Math.min(...vals) && v <= Math.max(...vals)),
  'never outside the real range',
)
const step = Array.from({ length: 40 }, (_, i) => (i < 20 ? 40 : 160))
const calmStep = c.calm(step)
assert.ok(
  calmStep.slice(0, 18).every(v => v === 40) && calmStep.slice(22).every(v => v === 160),
  'a real level change stays a step',
)

// Monotone cubic: evaluate each Bezier and stay within the two samples it joins.
const screen = kept.map(([t, v]) => [t / 60000, 300 - v])
const segs = c.monotoneSegments(screen)
assert.equal(segs.length, screen.length - 1)
const at = (s, u) => {
  const m = 1 - u
  return m ** 3 * s[1] + 3 * m * m * u * s[3] + 3 * m * u * u * s[5] + u ** 3 * s[7]
}
for (const [i, s] of segs.entries()) {
  if (i === 0 || i === segs.length - 1) continue // end tangents follow d3's slope2
  const lo = Math.min(s[1], s[7]) - 1e-9,
    hi = Math.max(s[1], s[7]) + 1e-9
  for (let u = 0; u <= 1; u += 0.05) {
    const y = at(s, u)
    assert.ok(y >= lo && y <= hi, `segment ${i} overshoots: ${y} outside ${lo}..${hi}`)
  }
}
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      c
        .monotoneSegments([
          [0, 5],
          [1, 5],
          [1, 9],
          [2, 5],
        ])
        .map(s => [s[0], s[6]]),
    ),
  ),
  [
    [0, 1],
    [1, 2],
  ],
  'duplicate x is skipped instead of dividing by zero',
)
// Real lines jitter by 3–10 ms between samples. Protecting every adjacent raw difference
// above the calm band brought the waves back (beta.7 review); only clear outliers and level
// changes may be kept raw, so the drawn line must stay much calmer than the samples.
{
  let s = 11
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647
  const gauss = () => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r())
  const variation = pts => pts.slice(1).reduce((sum, p, i) => sum + Math.abs(p[1] - pts[i][1]), 0)
  for (const [base, sd] of [
    [35, 3],
    [80, 4],
    [150, 10],
    [220, 15],
  ]) {
    const noisy = Array.from({ length: 1440 }, (_, i) => [i * 60000, base + sd * gauss()])
    noisy[700][1] = base * 4
    noisy[701][1] = base * 3
    const keep = 700 / 3,
      out = c.smoothPoints(noisy, keep)
    assert.ok(
      variation(out) < variation(noisy) * 0.4,
      `${base}±${sd} ms stays smooth: ${variation(out).toFixed(0)} vs raw ${variation(noisy).toFixed(0)}`,
    )
    assert.ok(out.length < keep * 1.3, `${base}±${sd} ms keeps the vertex budget: ${out.length}`)
    for (const i of [700, 701])
      assert.ok(
        out.some(p => p[0] === noisy[i][0] && p[1] === noisy[i][1]),
        'adjacent spikes inside jitter kept exactly',
      )
  }
}

console.log(
  'Chart smoothing: jitter calmed with spikes, dips and level steps exact; thinning keeps real samples; no overshoot between samples; duplicate x safe; realistic 3–15 ms jitter stays smooth passed.',
)
