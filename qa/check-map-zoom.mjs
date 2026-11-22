// 2.1.1 browser check: Star Map zoom on the built theme (dist/) with the preview fixtures.
// Buttons, Ctrl / pinch wheel, plain wheel hint, drag vs. click, double click, reset, phone width.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { extname, resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')
mkdirSync('qa/shots', { recursive: true })

const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname
  const path = resolve('dist', name === '/' || !extname(name) ? 'index.html' : name.slice(1))
  if (!path.startsWith(resolve('dist') + '/')) return res.writeHead(404).end()
  try {
    res.setHeader(
      'Content-Type',
      { '.html': 'text/html', '.webp': 'image/webp', '.png': 'image/png' }[extname(path)] ||
        'application/octet-stream',
    )
    res.end(readFileSync(path))
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port
const browser = await chromium.launch()
const errors = []

async function open(path, width = 1600, height = 1000, hasTouch = false) {
  const p = await browser.newPage({ viewport: { width, height }, hasTouch, isMobile: hasTouch })
  p.on('pageerror', e => errors.push(path + ': ' + e.message))
  p.on('console', m => m.type() === 'error' && errors.push(path + ': ' + m.text()))
  await p.addInitScript({ content: readFileSync('qa/fixtures.js', 'utf8') })
  await p.goto(base + path)
  await p.waitForFunction(() => window.NM?.lastSync && window.NM?._loaded)
  return p
}

/* Screen positions of the node dots, keyed by uuid. */
const dots = p =>
  p.$$eval('#mapC .sm-node', els =>
    Object.fromEntries(
      els.map(a => {
        const r = a.querySelector('.sm-dot').getBoundingClientRect()
        return [a.dataset.u, { x: r.x + r.width / 2, y: r.y + r.height / 2 }]
      }),
    ),
  )
const spread = d => {
  const v = Object.values(d)
  let m = 0
  for (const a of v) for (const b of v) m = Math.max(m, Math.hypot(a.x - b.x, a.y - b.y))
  return m
}
const svgBox = p => p.$eval('#mapC .sm-svg', s => s.getBoundingClientRect().toJSON())
const settle = p => p.waitForTimeout(120)

try {
  const p = await open('/worldmap')
  await p.waitForSelector('#mapC .sm-svg')
  const box0 = await svgBox(p),
    d0 = await dots(p),
    s0 = spread(d0)
  assert.equal(await p.locator('#mapC .sm-zoom button').count(), 3, 'three zoom buttons')
  assert.ok(await p.locator('[data-zoom="reset"]').isDisabled(), 'reset disabled at the auto view')

  // + zooms 1.6× about the centre; the map keeps its size
  await p.click('[data-zoom="in"]')
  await settle(p)
  const box1 = await svgBox(p)
  assert.ok(Math.abs(box1.height - box0.height) < 1 && Math.abs(box1.width - box0.width) < 1, 'same size')
  const s1 = spread(await dots(p))
  assert.ok(Math.abs(s1 / s0 - 1.6) < 0.05 || s1 / s0 > 1.2, `nodes spread out: ${(s1 / s0).toFixed(2)}×`)
  assert.ok(!(await p.locator('[data-zoom="reset"]').isDisabled()), 'reset enabled')
  // the focused button survives the redraw, so a second press works from the keyboard
  await p.focus('[data-zoom="in"]')
  await p.keyboard.press('Enter')
  await settle(p)
  assert.equal(await p.evaluate(() => document.activeElement?.dataset?.zoom), 'in', 'focus kept')

  // reset returns to the auto view exactly
  await p.click('[data-zoom="reset"]')
  await settle(p)
  const dr = await dots(p)
  for (const [u, q] of Object.entries(d0))
    assert.ok(Math.hypot(dr[u].x - q.x, dr[u].y - q.y) < 0.6, 'reset ' + u)

  // plain wheel over the map scrolls the page and shows the hint, no zoom
  const mid = { x: box0.x + box0.width / 2, y: box0.y + box0.height / 2 }
  await p.mouse.move(mid.x, mid.y)
  const y0 = await p.evaluate(() => scrollY)
  await p.mouse.wheel(0, 200)
  await p.waitForTimeout(250)
  assert.ok((await p.evaluate(() => scrollY)) > y0, 'page scrolled')
  assert.ok(await p.$eval('#mapC', b => b.classList.contains('hint')), 'hint shown')
  await p.evaluate(() => scrollTo(0, 0))
  await p.waitForTimeout(150)
  const sw = spread(await dots(p))
  assert.ok(Math.abs(sw - s0) < 0.6, 'plain wheel did not zoom')

  // Ctrl + wheel zooms at the pointer: the dot under the pointer stays put
  const b = await svgBox(p)
  const [u, q] = Object.entries(await dots(p))[0]
  await p.mouse.move(q.x, q.y)
  await p.keyboard.down('Control')
  await p.mouse.wheel(0, -300)
  await p.keyboard.up('Control')
  await settle(p)
  const dz = await dots(p)
  assert.ok(spread(dz) > s0 * 1.3, 'Ctrl + wheel zoomed in')
  assert.ok(Math.hypot(dz[u].x - q.x, dz[u].y - q.y) < 2, 'dot under the pointer stayed')
  assert.ok(await p.$eval('#mapC', b => b.classList.contains('zoomed')), 'zoomed class')

  // drag pans and does not open a node; a plain click on a node still opens it
  const before = await dots(p)
  const start = { x: b.x + b.width * 0.3, y: b.y + b.height * 0.5 }
  await p.mouse.move(start.x, start.y)
  await p.mouse.down()
  await p.mouse.move(start.x + 60, start.y + 25, { steps: 6 })
  await p.mouse.move(dz[u].x + 60, dz[u].y + 25, { steps: 6 }) // release over a node
  await p.mouse.up()
  await settle(p)
  assert.ok(p.url().endsWith('/worldmap'), 'drag ending on a node did not navigate')
  const after = await dots(p)
  const moved = Object.keys(before).filter(k => Math.abs(after[k].x - before[k].x) > 20)
  assert.ok(moved.length > 0, 'map moved with the drag')

  // double click on empty sea zooms in further
  const s2 = spread(await dots(p))
  await p.mouse.dblclick(b.x + 8, b.y + 8) // top-left corner, away from the buttons
  await settle(p)
  assert.ok(spread(await dots(p)) > s2 * 1.5, 'double click zoomed in')

  // the zoom survives a data refresh redraw
  const s3 = spread(await dots(p))
  await p.evaluate(() => window.dispatchEvent(new Event('resize')))
  await p.setViewportSize({ width: 1500, height: 1000 })
  await p.waitForTimeout(300)
  assert.ok(spread(await dots(p)) > s0 * 2, `zoom kept after resize (${(s3 / s0).toFixed(1)}×)`)

  // a node click without drag still navigates
  await p.click('[data-zoom="reset"]')
  await settle(p)
  const first = await p.$('#mapC .sm-node')
  const target = await first.getAttribute('data-u')
  const r = await first.$eval('.sm-dot', c => c.getBoundingClientRect().toJSON())
  await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2)
  await p.waitForTimeout(300)
  assert.ok(p.url().includes('/detail/' + target), 'click opens the node')
  await p.screenshot({ path: 'qa/shots/map-zoom.png' })
  await p.close()

  // phone width: controls fit, one-finger touch scrolls until zoomed in, two fingers pinch
  const m = await open('/worldmap', 390, 844, true)
  await m.waitForSelector('#mapC .sm-svg')
  const z = await m.$eval('#mapC .sm-zoom', e => e.getBoundingClientRect().toJSON())
  const stage = await m.$eval('#mapC', e => e.getBoundingClientRect().toJSON())
  assert.ok(z.right <= stage.right + 0.5 && z.x >= stage.x, 'controls inside the map')
  assert.equal(await m.$eval('#mapC .sm-map', e => getComputedStyle(e).touchAction), 'pan-y')
  // two-finger pinch (real touch events through DevTools) zooms in about the fingers
  await m.$eval('#mapC', e => e.scrollIntoView({ block: 'center' }))
  await m.waitForTimeout(200)
  const sp0 = spread(await dots(m))
  const mb = await svgBox(m)
  const cx = mb.x + mb.width / 2,
    cy = mb.y + mb.height / 2
  const cdp = await m.context().newCDPSession(m)
  const touch = (type, d) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints:
        type === 'touchEnd'
          ? []
          : [
              { x: cx - d, y: cy, id: 1 },
              { x: cx + d, y: cy, id: 2 },
            ],
    })
  await touch('touchStart', 20)
  for (let d = 24; d <= 60; d += 4) await touch('touchMove', d)
  await touch('touchEnd', 0)
  await m.waitForTimeout(200)
  const pinched = spread(await dots(m)) / sp0
  assert.ok(pinched > 2, `pinch zoomed in (${pinched.toFixed(2)}×, fingers 3×)`)
  assert.equal(await m.$eval('#mapC .sm-map', e => getComputedStyle(e).touchAction), 'none')
  await m.click('[data-zoom="reset"]')
  await settle(m)
  await m.click('[data-zoom="in"]')
  await settle(m)
  assert.equal(await m.$eval('#mapC .sm-map', e => getComputedStyle(e).touchAction), 'none')
  assert.ok((await m.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'no sideways scroll')
  await m.screenshot({ path: 'qa/shots/map-zoom-phone.png' })
  await m.close()

  assert.deepEqual(errors, [], 'no page errors')
  console.log(
    'Star Map zoom: buttons, Ctrl / pinch wheel at the pointer, plain wheel scrolls with a hint, drag pans without opening a node, double click, reset, resize, phone width and two-finger pinch passed.',
  )
} finally {
  await browser.close()
  server.close()
}
