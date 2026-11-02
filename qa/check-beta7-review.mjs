// Independent regression checks against the built theme: empty histories, dense
// adjacent spikes, raw hover values, timeout gaps, mobile tick labels and theme redraw.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { extname, resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')
mkdirSync('qa/shots', { recursive: true })
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname,
    path = resolve('dist', name === '/' || !extname(name) ? 'index.html' : name.slice(1))
  if (!path.startsWith(resolve('dist') + '/')) return res.writeHead(404).end()
  try {
    res.setHeader('Content-Type', extname(path) === '.html' ? 'text/html' : 'application/octet-stream')
    res.end(readFileSync(path))
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port,
  browser = await chromium.launch(),
  errors = [],
  results = []
async function open(empty = false) {
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  p.on('pageerror', e => errors.push(e.message))
  await p.addInitScript({ content: readFileSync('qa/fixtures.js', 'utf8') })
  await p.addInitScript(empty => {
    if (empty) {
      const original = window.fetch
      window.fetch = async (input, options = {}) => {
        const response = await original(input, options),
          path = String(input)
        if (path.includes('/api/rpc2')) {
          const body = JSON.parse(options.body || '{}')
          if (body.method === 'public:queryMetrics' && body.params.metric_keys.includes('ping.latency_ms'))
            return Response.json({ result: { series: [] } })
        }
        if (path.includes('/api/records/ping')) {
          const body = await response.json()
          body.data.records = []
          return Response.json(body)
        }
        return response
      }
    }
    const width = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width')
    Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
      ...width,
      set(v) {
        width.set.call(this, v)
        this.qaTimes = []
        this.qaStrokes = []
      },
    })
    const proto = CanvasRenderingContext2D.prototype
    for (const name of ['beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'stroke', 'fillText']) {
      const original = proto[name]
      proto[name] = function (...args) {
        if (name === 'beginPath') this.qaPath = []
        else if (name === 'stroke') (this.canvas.qaStrokes ||= []).push([...(this.qaPath || [])])
        else if (name === 'fillText') {
          if (/^(\d\d:\d\d|\d\d\/\d\d \d\dh)$/.test(args[0])) {
            const w = this.measureText(args[0]).width,
              left = args[1] - (this.textAlign === 'right' ? w : this.textAlign === 'center' ? w / 2 : 0)
            ;(this.canvas.qaTimes ||= []).push({ text: args[0], left, right: left + w })
          }
        } else (this.qaPath ||= []).push([name, ...args])
        return original.apply(this, args)
      }
    }
  }, empty)
  await p.goto(base + '/detail/demo-2?echo=preset')
  await p.waitForFunction(() => window.NM?._loaded && window.NM?.lastSync)
  await p.click('#detTabs [data-t="ping"]')
  await p.waitForFunction(
    () =>
      document.getElementById('chPingC') && !/LOADING/.test(document.getElementById('detCharts').textContent),
  )
  return p
}
try {
  const empty = await open(true)
  // Both groups are on the page at once (two boxes since beta.7 release).
  assert.equal(await empty.locator('#chPingPS .card.wait').count(), 4)
  assert.match(await empty.textContent('#chPingP'), /默认四线暂无样本/)
  assert.match(await empty.textContent('#chPingPS'), /等待采样/)
  assert.match(await empty.textContent('#chPingC'), /自定义目标暂无样本/)
  assert.equal(await empty.locator('#chPingCS .card.wait').count(), 3)
  assert.match(await empty.textContent('#chPingCS'), /等待采样/)
  assert.doesNotMatch(await empty.textContent('#chPingC'), /默认四线|没有自定义/)
  await empty.screenshot({ path: 'qa/shots/beta7-review-waiting.png', fullPage: true })
  await empty.close()
  results.push({ check: 'configured default/custom targets with zero samples', result: 'pass' })

  const p = await open()
  for (const width of [1600, 390, 320]) {
    await p.setViewportSize({ width, height: width < 500 ? 844 : 1000 })
    await p.waitForTimeout(250)
    for (const theme of ['light', 'dark']) {
      for (let i = 0; i < 3 && (await p.getAttribute('html', 'data-theme')) !== theme; i++)
        await p.click('#modeBtn')
      await p.waitForTimeout(50)
      const check = await p.$eval(
        '#chPingP',
        (h, long) => {
          const points = Array.from({ length: 400 }, (_, i) => [
            Date.UTC(2026, 10, 1) + i * (long ? (30 * 864e5) / 399 : 60000),
            i >= 195 && i <= 201 ? null : i === 90 ? 450 : i === 91 ? 350 : 100,
          ])
          h._cfg = {
            series: [{ name: 'Raw probe', color: 'blue', pts: points, fill: false }],
            fmt: v => String(v),
            smooth: true,
          }
          h._draw()
          const c = h.querySelector('canvas'),
            strokes = c.qaStrokes.filter(s => s.some(p => p[0] === 'bezierCurveTo')),
            xs = strokes.flatMap(s => s.map(p => (p[0] === 'bezierCurveTo' ? p[5] : p[1]))),
            x = i => 46 + (i / 399) * (h.clientWidth - 56),
            jumpHeights = [90, 91].map(i => {
              const command = strokes
                .flat()
                .find(p => p[0] === 'bezierCurveTo' && Math.abs(p[5] - x(i)) < 1e-6)
              return command ? command[6] : null
            }),
            axisMax = 550,
            y = v => 10 + (h.clientHeight - 32) * (1 - v / axisMax)
          return {
            times: c.qaTimes,
            strokes: strokes.length,
            baselineBefore: xs.some(v => Math.abs(v - x(89)) < 1e-6),
            baselineAfter: xs.some(v => Math.abs(v - x(92)) < 1e-6),
            jumpHeights,
            expectedHeights: [y(450), y(350)],
            raw: h._cfg.series[0].pts[91][1],
            hoverX: x(91),
            theme: document.documentElement.dataset.theme,
            overflow: document.documentElement.scrollWidth - innerWidth,
          }
        },
        width === 320,
      )
      assert.equal(check.theme, theme)
      if (check.overflow) {
        console.log(
          'Scroll boxes',
          await p.$$eval('body *', es =>
            es
              .filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).display !== 'none')
              .map(e => ({
                tag: e.tagName,
                cls: e.className,
                id: e.id,
                w: e.clientWidth,
                sw: e.scrollWidth,
                rect: { x: e.getBoundingClientRect().x, right: e.getBoundingClientRect().right },
                ox: getComputedStyle(e).overflowX,
              }))
              .slice(-25),
          ),
        )
        console.log(
          'Overflow',
          width,
          theme,
          await p.$$eval('body *', es =>
            es
              .filter(e => e.getBoundingClientRect().right > innerWidth + 1)
              .map(e => ({
                tag: e.tagName,
                cls: e.className,
                id: e.id,
                right: e.getBoundingClientRect().right,
                text: e.textContent.slice(0, 90),
              }))
              .slice(-15),
          ),
        )
        await p.screenshot({ path: 'qa/shots/beta7-review-overflow.png', fullPage: true })
      }
      assert.equal(check.overflow, 0, `${width} ${theme} overflow`)
      assert.equal(check.strokes, 2, 'timeout run divides the line into two independent paths')
      assert.ok(check.baselineBefore && check.baselineAfter, 'spikes do not bleed into adjacent samples')
      for (let i = 0; i < 2; i++)
        assert.ok(
          Math.abs(check.jumpHeights[i] - check.expectedHeights[i]) < 1e-6,
          'both raw spike heights drawn',
        )
      assert.equal(check.raw, 350, 'rendering never changes the source')
      for (let i = 1; i < check.times.length; i++)
        assert.ok(check.times[i].left - check.times[i - 1].right >= 6, 'time labels stay apart')
      await p.$eval('#chPingP', e => e.scrollIntoView({ block: 'center' }))
      const box = await p.locator('#chPingP').boundingBox()
      await p.mouse.move(box.x + check.hoverX, box.y + 30)
      assert.match(await p.textContent('#chPingP .tip'), /Raw probe\s+350/)
      assert.equal(await p.locator('#chPingP .tip').isVisible(), true)
      assert.equal(
        await p.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        0,
        'visible tooltip fits',
      )
      results.push({ width, theme, ...check })
      if (width === 320 || (width === 1600 && theme === 'light'))
        await p.screenshot({ path: `qa/shots/beta7-review-chart-${width}-${theme}.png`, fullPage: true })
    }
  }
  await p.close()
  assert.deepEqual(errors, [])
  writeFileSync('qa/shots/beta7-review-results.json', JSON.stringify(results, null, 2) + '\n')
  console.log(
    'Independent beta.7 browser review: empty histories, adjacent raw spike heights, baseline neighbours, timeout gaps, raw hover, separated mobile ticks, theme-button redraw and no overflow passed.',
  )
} finally {
  await browser.close()
  server.close()
}
