// Compare beta.2 and the candidate main-thread task time in one rendering environment.
// Usage: node qa/bench-chairs.mjs <beta.2-preview.html> [seconds=8]
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const { chromium } = createRequire(import.meta.url)('playwright')
const baseline = resolve(process.argv[2]),
  current = resolve('preview/NanoMuse-preview.html'),
  seconds = +(process.argv[3] || 8)
const browser = await chromium.launch()
// Page main-thread task time is measurable even when this execution service
// hides browser OS process IDs / freezes SystemInfo CPU counters.
const taskTime = async session => {
  const { metrics } = await session.send('Performance.getMetrics')
  const value = metrics.find(m => m.name === 'TaskDuration')?.value
  if (!Number.isFinite(value)) throw Error('TaskDuration is unavailable')
  return value
}
const results = []
try {
  for (const [label, file] of [
    ['beta.2', baseline],
    ['beta.3', current],
  ]) {
    console.log(label, 'preview SHA256', createHash('sha256').update(readFileSync(file)).digest('hex'))
    for (const [route, motion] of [
      ['/', 'on'],
      ['/duty', 'on'],
      ['/duty', 'off'],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }),
        p = await ctx.newPage()
      await p.goto('file://' + file + '#' + route)
      await p.waitForFunction(() => window.NM?.lastSync)
      if (motion === 'off') await p.click('#motionBtn')
      await p.waitForTimeout(3000)
      const session = await ctx.newCDPSession(p)
      await session.send('Performance.enable')
      const start = await taskTime(session)
      await p.waitForTimeout(seconds * 1000)
      const end = await taskTime(session)
      const result = {
        label,
        route,
        motion,
        mainThreadTaskPercent: Math.round(((end - start) / seconds) * 1000) / 10,
      }
      results.push(result)
      console.log(JSON.stringify(result))
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}
console.log(
  'Measured renderer main-thread TaskDuration share, not whole-browser CPU or GPU/raster cost. Compare only these same-environment cases.',
)
