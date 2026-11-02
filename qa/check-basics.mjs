import assert from 'node:assert/strict'
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve, extname } from 'node:path'
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
const browser = await chromium.launch(),
  errors = []
const base = 'http://127.0.0.1:' + server.address().port
const page = async (admin = false) => {
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  p.on('pageerror', e => errors.push(e.message))
  p.on('console', m => m.type() === 'error' && errors.push(m.text()))
  await p.addInitScript({ content: readFileSync('qa/fixtures.js', 'utf8') })
  await p.goto(base + (admin ? '/?admin=1' : '/'))
  await p.waitForFunction(() => window.NM?.lastSync)
  return p
}
try {
  const p = await page()
  await p.click('[data-v="list"]')
  await p.waitForSelector('.echo-target')
  assert.equal(await p.locator('#echoPresetAdmin').isVisible(), false)
  await p.click('[data-echo-group="preset"]')
  assert.equal(await p.locator('.echo-card').first().locator('.echo-preset-empty').count(), 4)
  assert.match(await p.locator('.echo-card').first().textContent(), /尚未启用/)
  await p.click('[data-echo-group="custom"]')
  await p.click('#echoCustomPicker summary')
  await p.uncheck('[data-echo-task="1"]')
  assert.equal(await p.locator('.echo-card').first().locator('.echo-target').count(), 2)
  await p.click('#echoAllTargets')
  assert.equal(await p.locator('.echo-card').first().locator('.echo-target').count(), 3)
  await p.click('[data-p="traffic"]')
  await p.waitForSelector('#trafficChart canvas')
  assert.equal(await p.locator('.traffic-node').count(), 16)
  assert.match(await p.textContent('#trafficTiles'), /累计上传.*累计下载.*累计双向/s)
  assert.match(await p.textContent('#trafficHistoryMeta'), /16 \/ 16/)
  const anchor = p.locator('.traffic-node a').first()
  await anchor.focus()
  await p.waitForTimeout(2800)
  assert.equal(
    await anchor.evaluate(e => document.activeElement === e),
    true,
    'live updates retain link focus',
  )
  await p.evaluate(() => {
    const original = window.fetch
    window.fetch = async (url, options) => {
      if (
        options?.body &&
        JSON.parse(options.body).method === 'public:queryMetrics' &&
        JSON.parse(options.body).params.metric_keys.includes('net.in.rate')
      ) {
        window.fetch = original
        await new Promise(r => (window.releaseTraffic = r))
      }
      return original(url, options)
    }
  })
  await p.click('#trafficHours [data-hours="1"]')
  await p.waitForFunction(() => !!window.releaseTraffic)
  await p.selectOption('#trafficGroup', '日本')
  await p.evaluate(() => window.releaseTraffic())
  await p.waitForFunction(() => document.getElementById('trafficHistoryMeta').textContent.includes('2 / 2'))
  assert.equal(
    await p.locator('.traffic-node').count(),
    2,
    'late whole-fleet response cannot restore old scope',
  )
  await p.selectOption('#trafficGroup', 'ALL')
  await p.fill('#trafficSearch', 'Tokyo')
  assert.equal(await p.locator('.traffic-node').count(), 1)
  await p.fill('#trafficSearch', '')
  await p.selectOption('#trafficSort', 'total')
  assert.match(await p.locator('.traffic-node a').first().textContent(), /London/)
  await p.locator('.traffic-node a').first().click()
  assert.match(await p.textContent('#detTraffic'), /累计上传.*累计下载.*累计双向.*配置配额/s)
  await p.click('[data-p="traffic"]')
  for (const width of [1440, 900, 680, 390, 320]) {
    await p.setViewportSize({ width, height: 1000 })
    assert.equal(
      await p.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)),
      0,
      'traffic overflow ' + width,
    )
  }
  await p.setViewportSize({ width: 1440, height: 1100 })
  await p.waitForTimeout(800)
  await p.screenshot({ path: 'qa/shots/traffic-page.jpg', type: 'jpeg', quality: 72 })
  const mutations = await p.evaluate(() =>
    previewRequests.filter(r => r.method?.startsWith('admin:') || r.path.startsWith('/api/admin/')),
  )
  assert.equal(mutations.length, 0, 'guest browsing never creates tasks or saves settings')
  await p.close()

  const a = await page(true)
  await a.click('[data-v="list"]')
  await a.click('#echoPresetAdmin summary')
  assert.equal(await a.inputValue('#echoTarget-telecom'), '124.237.177.164')
  assert.equal(await a.inputValue('#echoTarget-unicom'), '110.242.74.102')
  assert.equal(await a.locator('#echoPresetVerification').isVisible(), false)
  await a.click('#echoReviewPresets')
  await a.waitForSelector('#echoPresetReview table')
  await a.click('#echoEnablePresets')
  await a.waitForFunction(() => document.getElementById('echoPresetStatus').textContent.includes('已启用'))
  await a.waitForFunction(
    () => document.querySelector('.echo-card .echo-target-name')?.textContent === '电信 · 河北',
  )
  assert.equal(await a.locator('.echo-card').first().locator('.echo-target').count(), 4)
  assert.equal(
    await a.evaluate(() => previewRequests.filter(r => r.method === 'admin:addPingTask').length),
    4,
  )
  assert.equal(
    await a.evaluate(() => NM.ts.version_tag),
    'v2.1.0-design.7',
    'saving preserves unrelated theme settings',
  )
  await a.click('#echoReviewPresets')
  await a.waitForSelector('#echoPresetReview table')
  await a.click('#echoEnablePresets')
  await a.waitForFunction(() => document.getElementById('echoEnablePresets').hidden)
  assert.equal(
    await a.evaluate(() => previewRequests.filter(r => r.method === 'admin:addPingTask').length),
    4,
    'second enable creates nothing',
  )
  await a.reload()
  await a.waitForSelector('.echo-card .echo-target-name')
  assert.equal(
    await a.locator('.echo-card').first().locator('.echo-target').count(),
    4,
    'bindings survive reload',
  )
  await a.setViewportSize({ width: 390, height: 1000 })
  assert.equal(
    await a.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)),
    0,
    'Echo controls fit mobile',
  )
  await a.close()
  assert.deepEqual(errors, [])
  console.log(
    'Browser basics: guest read-only, default/custom groups, admin enable/reuse/persistence, traffic filters/history race/focus, detail counters and 320–1440px passed.',
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise(r => server.close(r))
}
