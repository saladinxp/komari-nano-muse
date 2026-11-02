// Static Stellar Core duty presence: lazy assets, real states, shared binding and responsive layout.
// Run npm run build first. Uses production output with API fixtures for asset checks,
// then the standalone preview for scenario switching.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve, extname } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')
mkdirSync('qa/shots', { recursive: true })
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname
  const path = resolve('dist', name === '/' ? 'index.html' : name.slice(1))
  if (!path.startsWith(resolve('dist') + '/')) return res.writeHead(404).end()
  try {
    const body = readFileSync(path)
    res.setHeader(
      'Content-Type',
      { '.html': 'text/html', '.webp': 'image/webp' }[extname(path)] || 'application/octet-stream',
    )
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const browser = await chromium.launch()
const errors = []
try {
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  p.on('pageerror', e => errors.push(e.message))
  p.on('console', m => m.type() === 'error' && errors.push(m.text()))
  const assets = []
  p.on('request', r => {
    if (r.url().includes('/scene-art/')) assets.push(r.url())
  })
  await p.addInitScript({ content: readFileSync('qa/fixtures.js', 'utf8') })
  await p.goto('http://127.0.0.1:' + server.address().port)
  await p.waitForFunction(() => window.NM?.lastSync)
  assert.equal(assets.length, 0, 'compact cards do not fetch scene art')
  await p.click('[data-v="list"]')
  assert.equal(assets.length, 0, 'Echo does not fetch scene art')
  await p.click('[data-v="large"]')
  assert.equal(await p.locator('.core-crew').count(), 0, 'new default is off')
  await p.click('#coreCrewToggle')
  await p.waitForFunction(
    () => document.querySelectorAll('.core-crew-art > svg:not(.core-crew-sweat)').length === 16,
  )
  assert.equal(new Set(assets).size, 6, 'only the six shared character atlases are fetched')
  assert.ok(
    assets.every(u => /\/cast-[^/]+\.webp$/.test(u)),
    'no room or home background fetched',
  )
  assert.equal(await p.$$eval('.core-crew canvas', es => es.length), 0, 'no per-card animation canvas')
  await p.close()

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  const file = 'file://' + resolve('preview/NanoMuse-preview.html') + '#/'
  await page.goto(file)
  await page.waitForFunction(() => window.NM?.lastSync)
  await page.click('[data-v="large"]')
  await page.click('#coreCrewToggle')
  await page.waitForFunction(
    () => document.querySelectorAll('.core-crew-art > svg:not(.core-crew-sweat)').length === 16,
  )
  assert.equal(
    await page.$$eval('.core-crew-art > svg:not(.core-crew-sweat)', es =>
      es.every(svg => {
        const rect = svg.querySelector('clipPath rect')
        return (
          svg.querySelector('image')?.hasAttribute('clip-path') &&
          ['x', 'y', 'width', 'height'].map(a => rect?.getAttribute(a)).join(' ') ===
            svg.getAttribute('viewBox')
        )
      }),
    ),
    true,
    'sprite clipping matches the exact atlas frame, including letterboxed poses',
  )
  await page.waitForFunction(
    () => document.querySelector('[data-core-crew="demo-0"]')?.dataset.mood === 'idle',
  )
  assert.match(
    await page.textContent('[data-core-crew="demo-0"]'),
    /休息待命/,
    'Core seeds idle history before opening Duty',
  )
  assert.equal(await page.getAttribute('[data-core-crew="demo-15"]', 'data-mood'), 'offline')
  assert.match(await page.textContent('[data-core-crew="demo-15"]'), /离线休眠/)
  const binding = await page.textContent('[data-core-crew="demo-0"] b')
  const box = await page.locator('.nodes-large .nc').first().boundingBox()
  await page
    .locator('.nodes-large .nc')
    .first()
    .screenshot({ path: 'qa/shots/core-duty-card.jpg', type: 'jpeg', quality: 82 })
  await page.evaluate(() => document.getElementById('nodes').scrollIntoView())
  await page.screenshot({ path: 'qa/shots/core-duty-light.png' })
  assert.ok(box.height < 380, 'core remains a compact instrument, height=' + box.height)
  await page.click('#coreCrewToggle')
  assert.equal(await page.locator('.core-crew').count(), 0)
  await page.reload()
  await page.waitForFunction(() => window.NM?.lastSync)
  assert.equal(await page.locator('.core-crew').count(), 0, 'visitor preference survives reload')
  await page.click('#coreCrewToggle')
  assert.equal(await page.textContent('[data-core-crew="demo-0"] b'), binding, 'binding survives toggling')
  await page.evaluate(() => (location.hash = '#/duty'))
  await page.waitForSelector('#dutyRoster [data-pick="demo-0"]')
  await page.click('#dutyRoster [data-pick="demo-0"]')
  await page.click('#dutyPick [data-cast="seina"]')
  await page.evaluate(() => (location.hash = '#/'))
  await page.waitForSelector('[data-core-crew="demo-0"]')
  assert.equal(await page.textContent('[data-core-crew="demo-0"] b'), '星奈', 'room selection is reused')
  await page.evaluate(() => {
    localStorage.removeItem('nm-core-crew')
    window.NM.ts.core_crew = 'off'
    window.__NM_APP__.route()
  })
  assert.equal(
    await page.locator('.core-crew').count(),
    0,
    'admin default off works without a visitor choice',
  )
  await page.click('#coreCrewToggle')
  await page.waitForSelector('.core-crew-art > svg:not(.core-crew-sweat)')
  await page.evaluate(() => window.previewScenario('allonline'))
  await page.waitForFunction(
    () => document.querySelector('[data-core-crew="demo-15"]')?.dataset.mood !== 'offline',
  )
  await page.evaluate(() => window.previewScenario('alloffline'))
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.core-crew')].every(e => e.dataset.mood === 'offline'),
  )
  await page.evaluate(() => window.previewScenario('normal'))
  await page.waitForFunction(
    () => document.querySelector('[data-core-crew="demo-0"]')?.dataset.mood !== 'offline',
  )
  for (const width of [1280, 900, 680, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
    assert.ok(overflow <= 0, 'no horizontal page overflow at ' + width)
    const clipped = await page.$$eval('.nodes-large .resource', es =>
      es.some(e => e.scrollWidth > e.clientWidth + 1),
    )
    assert.equal(clipped, false, 'resource readings fit at ' + width)
  }
  await page.locator('.nodes-large .nc').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'qa/shots/core-duty-phone.png' })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.evaluate(() => document.getElementById('modeBtn').click())
  await page.locator('.nodes-large .nc').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'qa/shots/core-duty-dark.png' })
  await page.click('[data-v="medium"]')
  assert.equal(await page.locator('.core-crew').count(), 0, 'compact mode stays clear')
  await page.click('[data-v="list"]')
  assert.equal(await page.locator('.core-crew').count(), 0, 'Echo stays clear')
  assert.deepEqual(errors, [])
  console.log(
    'Core crew: lazy six atlases, shared binding, state changes, toggle persistence and 320–1600px layouts passed.',
  )
  await page.close()
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise(done => server.close(done))
}
