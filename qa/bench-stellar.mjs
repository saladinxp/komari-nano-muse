// Same Chromium/environment only; renderer TaskDuration share is not whole-browser CPU.
// node qa/bench-stellar.mjs <beta4-preview.html> [seconds=8]
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const { chromium } = createRequire(import.meta.url)('playwright')
const seconds = Number(process.argv[3] || 8),
  results = []
const browser = await chromium.launch()
try {
  for (const [label, file] of [
    ['beta.4', resolve(process.argv[2])],
    ['beta.5', resolve('preview/NanoMuse-preview.html')],
  ]) {
    console.log(label, createHash('sha256').update(readFileSync(file)).digest('hex'))
    for (const view of ['medium', 'large', 'list', 'duty', 'duty-off']) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
      await context.addInitScript(
        view => localStorage.setItem('nm-view', view.startsWith('duty') ? 'medium' : view),
        view,
      )
      const p = await context.newPage()
      await p.goto('file://' + file + '#' + (view.startsWith('duty') ? '/duty' : '/'))
      await p.waitForFunction(() => NM?.lastSync)
      if (view === 'duty-off') await p.click('#motionBtn')
      if (!view.startsWith('duty'))
        await p.$eval('#nodes', e => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 95))
      await p.waitForTimeout(2000)
      const cdp = await context.newCDPSession(p)
      await cdp.send('Performance.enable')
      const task = async () =>
        (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'TaskDuration').value
      const before = await task()
      await p.waitForTimeout(seconds * 1000)
      const after = await task()
      const row = {
        label,
        view,
        seconds,
        mainThreadTaskPercent: Math.round(((after - before) / seconds) * 1000) / 10,
      }
      results.push(row)
      console.log(row)
      await context.close()
    }
  }
} finally {
  await browser.close()
}
mkdirSync('qa/shots', { recursive: true })
writeFileSync('qa/shots/beta5-performance.json', JSON.stringify(results, null, 2) + '\n')
