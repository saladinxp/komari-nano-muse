// Compare the exact original beta.7 preview with the reviewed preview on this
// browser/runtime. TaskDuration is a main-thread proxy, not host CPU usage.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright'),
  browser = await chromium.launch(),
  results = []
try {
  for (let round = 0; round < 2; round++) {
    for (const [label, file] of round
      ? [
          ['reviewed', resolve('preview/NanoMuse-preview.html')],
          ['original', resolve(process.argv[2])],
        ]
      : [
          ['original', resolve(process.argv[2])],
          ['reviewed', resolve('preview/NanoMuse-preview.html')],
        ]) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } }),
        p = await context.newPage()
      await p.goto('file://' + file + '?echo=preset#/detail/demo-2')
      await p.waitForFunction(() => window.NM?._loaded && window.NM?.lastSync)
      await p.click('#detTabs [data-t="ping"]')
      await p.waitForSelector('#chPingP canvas, #chPing canvas') // two boxes since the release
      await p.$eval('#detCharts', e => e.scrollIntoView({ block: 'center' }))
      await p.waitForTimeout(1000)
      const cdp = await context.newCDPSession(p)
      await cdp.send('Performance.enable')
      const task = async () =>
          (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'TaskDuration').value,
        before = await task()
      await p.waitForTimeout(8000)
      const idle = (((await task()) - before) / 8) * 100,
        draw = await p.$eval('#chPingP, #chPing', h => {
          const before = performance.now()
          for (let i = 0; i < 200; i++) h._draw(46 + ((i % 101) / 100) * (h.clientWidth - 56))
          return {
            millisecondsPerDraw: (performance.now() - before) / 200,
            series: h._cfg.series.length,
            samples: h._cfg.series.map(s => s.pts.length),
          }
        }),
        row = {
          round: round + 1,
          label,
          sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
          idleMainThreadTaskPercent: idle,
          ...draw,
        }
      results.push(row)
      console.log(row)
      await context.close()
    }
  }
} finally {
  await browser.close()
}
writeFileSync('qa/shots/beta7-review-performance.json', JSON.stringify(results, null, 2) + '\n')
