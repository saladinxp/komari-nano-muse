import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
const { chromium } = createRequire(import.meta.url)('playwright')
mkdirSync('qa/shots', { recursive: true })
const browser = await chromium.launch(),
  errors = [],
  measurements = []
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  await page.goto('file://' + resolve('preview/NanoMuse-preview.html') + '#/')
  await page.waitForFunction(() => NM?.lastSync)
  for (const [width, height] of [
    [1600, 1000],
    [1920, 1080],
    [390, 844],
    [320, 740],
    [680, 1000],
  ]) {
    await page.setViewportSize({ width, height })
    for (const mode of ['medium', 'large', 'list']) {
      await page.click(`[data-v="${mode}"]`)
      await page.waitForTimeout(150)
      await page.$eval('#nodes', e => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 95))
      const m = await page.$$eval('#nodes .nc', es => ({
        cards: es.map(e => {
          const b = e.getBoundingClientRect()
          return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom }
        }),
        overflow: document.documentElement.scrollWidth - innerWidth,
      }))
      const row = m.cards.filter(c => Math.abs(c.y - m.cards[0].y) < 1).length
      const full = m.cards.filter(c => c.y >= 75 && c.bottom <= height).length
      const maxHeight = Math.max(...m.cards.map(c => c.h))
      assert.equal(m.overflow, 0, `${width} ${mode} page overflow`)
      if (width >= 1400 && mode === 'large') {
        assert.equal(row, width === 1920 ? 4 : 3)
        assert.ok(maxHeight <= 380, `core ${width} height ${maxHeight}`)
        assert.ok(full >= 6, `core full ${full}`)
      }
      if (width >= 1400 && mode === 'medium') assert.equal(row, width === 1920 ? 6 : 5)
      if (width >= 1400 && mode === 'list') {
        assert.equal(row, 3)
        assert.ok(maxHeight <= 260, `echo height ${maxHeight}`)
      }
      if (width === 390 && mode === 'list') assert.ok(full >= 2, `phone echo full ${full}`)
      assert.equal(
        await page.$$eval('.resource', es => es.some(e => e.scrollWidth > e.clientWidth + 1)),
        false,
        'readings fit ' + width + ' ' + mode,
      )
      const measure = { width, height, mode, row, full, maxHeight }
      measurements.push(measure)
      console.log(measure)
      if ([1600, 1920, 390, 320].includes(width))
        await page.screenshot({ path: `qa/shots/beta4-${mode}-${width}.png` })
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.click('[data-v="large"]')
  assert.equal(await page.locator('.core-crew').count(), 0, 'new default keeps data space')
  await page.evaluate(() => {
    // Freeze only fixture socket frames while asserting injected fields. Restore before
    // checking live updates below; a slow assertion must not race the next 2.5 s frame.
    const socket = NM.ws,
      receive = socket.onmessage
    socket.onmessage = () => {}
    window.resumeStellarFrames = () => (socket.onmessage = receive)
    const n = NM.nodes.find(n => n.uuid === 'demo-0')
    n.swap_total = 0
    Object.assign(NM.live[n.uuid], {
      _hasCpu: false,
      _hasMemory: false,
      _hasDisk: false,
      _hasNetwork: false,
      _hasLoad: false,
      _hasConnections: false,
      _hasProcess: false,
      swap_total: 0,
    })
    __NM_APP__.route()
  })
  assert.match(
    await page.locator('[data-u="demo-0"] [data-core-facts]').textContent(),
    /— \/ — \/ —.*— \/ — · —/s,
  )
  assert.equal(
    await page.locator('[data-u="demo-0"] [data-v="cpu"]').textContent(),
    '—',
    'missing CPU is not zero',
  )
  assert.doesNotMatch(await page.locator('[data-u="demo-0"] [data-core-facts]').textContent(), /Swap/)
  await page.evaluate(() => {
    Object.assign(NM.live['demo-0'], {
      _hasCpu: true,
      _hasMemory: true,
      _hasDisk: true,
      _hasNetwork: true,
      _hasLoad: true,
      load1: 0,
      load5: 1.25,
      load15: 2.5,
      _hasConnections: true,
      tcp: 0,
      udp: 2,
      _hasProcess: true,
      process: 0,
      swap_total: 1073741824,
      swap_used: 268435456,
    })
    __NM_APP__.route()
  })
  const complete = await page.locator('[data-u="demo-0"] [data-core-facts]').textContent()
  assert.match(complete, /0.00 \/ 1.25 \/ 2.50/)
  assert.match(complete, /0 \/ 2 · 0/)
  assert.match(complete, /Swap/)
  assert.ok((await page.locator('[data-u="demo-0"]').boundingBox()).height <= 380, 'swap card stays compact')
  await page.evaluate(() => window.resumeStellarFrames())
  const link = page.locator('[data-u="demo-1"]')
  await link.focus()
  await link.evaluate(e => (window.testCard = e))
  await page.waitForTimeout(2700)
  assert.equal(
    await link.evaluate(e => e === window.testCard && e === document.activeElement),
    true,
    'live frame retains card and focus',
  )
  await page.evaluate(() => (NM.ws.onmessage = () => {}))
  await page.selectOption('#nodeSort', 'cpu')
  const order = await page.$$eval('#nodes .nc', es => es.map(e => e.dataset.u))
  const expected = await page.evaluate(() =>
    NM.nodes
      .filter(n => !n.hidden)
      .sort(
        (a, b) =>
          (NM.online.has(b.uuid) ? NM.live[b.uuid].cpu : -1) -
          (NM.online.has(a.uuid) ? NM.live[a.uuid].cpu : -1),
      )
      .map(n => n.uuid),
  )
  assert.deepEqual(order, expected, 'CPU sort online first, missing last')
  await page.click('[data-g="日本"]')
  assert.equal(await page.locator('#nodes .nc').count(), 2)
  await page.fill('#search', 'Tokyo')
  assert.equal(await page.locator('#nodes .nc').count(), 1)
  await page.fill('#search', '')
  await page.selectOption('#statusFilter', 'offline')
  assert.equal(await page.locator('#nodes .nc').count(), 0)
  await page.selectOption('#statusFilter', 'all')
  await page.click('[data-g="ALL"]')
  await page.evaluate(() => window.resumeStellarFrames())
  await page.reload()
  await page.waitForFunction(() => NM?.lastSync)
  assert.equal(await page.inputValue('#nodeSort'), 'cpu', 'sort persisted')
  await page.click('[data-v="list"]')
  await page.click('[data-echo-group="preset"]')
  assert.equal(await page.locator('.echo-card').first().locator('.echo-preset-empty').count(), 4)
  assert.equal(
    await page.$$eval('.echo-card', es => es.some(e => /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(e.innerText))),
    false,
    'visitor wait rows show names without IP',
  )
  const rates = await page.evaluate(() =>
    previewRequests.filter(
      r => r.method === 'public:queryMetrics' && r.params.metric_keys.includes('net.in.rate'),
    ),
  )
  assert.ok(
    rates.every(r => !r.params.entity_id),
    'network curves use bulk queries',
  )
  const mutations = await page.evaluate(() =>
    previewRequests.filter(r => r.method?.startsWith('admin:') || r.path.startsWith('/api/admin/')),
  )
  assert.deepEqual(mutations, [], 'visitor remains read only')
  await page.close()
  assert.deepEqual(errors, [])
  writeFileSync('qa/shots/beta4-layout.json', JSON.stringify(measurements, null, 2) + '\n')
  console.log(
    'Stellar views: sizes, six core cards, phone echo, missing/zero/Swap, persistent sort, filters, focus, shared batch and IP-free waits passed.',
  )
} finally {
  await browser.close()
}
