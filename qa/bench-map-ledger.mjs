// Main-thread task time on the Star Map and Ledger pages, beta.5 preview vs this build.
// Same Chromium / machine only; renderer TaskDuration share is not whole-browser CPU.
// node qa/bench-map-ledger.mjs <beta5-preview.html> [seconds=8] [rounds=2]
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const { chromium } = createRequire(import.meta.url)('playwright')
const seconds = Number(process.argv[3] || 8),
  rounds = Number(process.argv[4] || 2),
  results = []
const builds = [
  ['beta.5', resolve(process.argv[2])],
  ['beta.6', resolve('preview/NanoMuse-preview.html')],
]
const browser = await chromium.launch()
try {
  for (const [label, file] of builds)
    console.log(label, createHash('sha256').update(readFileSync(file)).digest('hex'))
  for (let round = 1; round <= rounds; round++)
    for (const [label, file] of builds)
      for (const [view, query] of [
        ['worldmap', ''],
        ['worldmap', '?echo=preset'],
        ['billing', ''],
      ]) {
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
        const p = await context.newPage()
        const cdp = await context.newCDPSession(p)
        await cdp.send('Performance.enable')
        const task = async () =>
          (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'TaskDuration').value
        await p.goto('file://' + file + query + '#/' + view)
        await p.waitForFunction(() => window.NM?.lastSync && window.NM?._loaded)
        await p.waitForTimeout(2000)
        const before = await task()
        await p.waitForTimeout(seconds * 1000)
        const after = await task()
        const row = {
          round,
          label,
          view: view + (query ? ' (preset)' : ''),
          seconds,
          taskSeconds: Number((after - before).toFixed(4)),
          mainThreadPercent: Number((((after - before) / seconds) * 100).toFixed(2)),
        }
        results.push(row)
        console.log(JSON.stringify(row))
        await context.close()
      }
} finally {
  await browser.close()
}
mkdirSync('qa/shots', { recursive: true })
writeFileSync('qa/shots/bench-map-ledger.json', JSON.stringify(results, null, 2))
