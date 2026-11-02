// 2.1.0-beta.7 browser check: 默认四线 and 自定义目标 never mix — Echo view, target picker and
// the detail latency chart — plus the hidden-pill and free-node fixes. Built theme (dist/) with
// the preview fixtures; mock samples only.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
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
async function open(path, width = 1600, height = 1000) {
  const p = await browser.newPage({ viewport: { width, height } })
  p.on('pageerror', e => errors.push(path + ': ' + e.message))
  p.on('console', m => m.type() === 'error' && errors.push(path + ': ' + m.text()))
  await p.addInitScript({ content: readFileSync('qa/fixtures.js', 'utf8') })
  await p.goto(base + path)
  await p.waitForFunction(() => window.NM?.lastSync && window.NM?._loaded)
  return p
}
const DEFAULT = ['电信 · 河北', '联通 · 河北', '移动 · 河北', 'Google']
const CUSTOM = ['北京联通', '上海电信', 'Cloudflare']
// The detail page shows both groups at once, each box with its own stat cards and scale.
const names = (p, id) => p.$$eval(`#${id}S .card .h`, h => h.map(x => x.textContent.trim()))
const dots = (p, id) => p.$$eval(`#${id}S .card .h i`, i => i.map(x => x.style.background))
const waitChart = p =>
  p.waitForFunction(() => {
    const box = document.getElementById('detCharts')
    return box && document.getElementById('chPingC') && !/LOADING/.test(box.textContent)
  })

try {
  /* ── default lines enabled (?echo=preset); task 8 is an unbound old 「回声预设 · 电信 · 北京」 ── */
  {
    const p = await open('/?echo=preset')
    await p.click('[data-v="list"]')
    await p.waitForSelector('.echo-card .echo-target')
    await p.click('[data-echo-group="preset"]')
    const first = p.locator('.echo-card').first()
    assert.deepEqual(await first.locator('.echo-target-name').allTextContents(), DEFAULT)
    await p.click('[data-echo-group="custom"]')
    assert.deepEqual(
      await first.locator('.echo-target-name').allTextContents(),
      CUSTOM,
      'custom: own targets only',
    )
    const options = await p.$$eval('#echoTargetOptions label', l => l.map(x => x.textContent.trim()))
    assert.deepEqual(options, CUSTOM, 'picker lists custom targets only, not default lines or old ones')
    const all = await p.$$eval('.echo-card .echo-target-name', n => n.map(x => x.textContent))
    assert.ok(
      !all.some(t => /河北|Google|北京$/.test(t) && !CUSTOM.includes(t)),
      'no default line in any custom card',
    )

    // Echo card → detail latency: both groups in their own boxes, whatever Echo shows.
    await p.click('.echo-card[data-u="demo-2"]')
    await waitChart(p)
    assert.equal(await p.locator('#detGroup').count(), 0, 'no group switch on the detail page')
    assert.deepEqual(await names(p, 'chPingP'), DEFAULT)
    assert.deepEqual(await names(p, 'chPingC'), CUSTOM)
    assert.match(await p.textContent('#chPingPBox .cc-h'), /默认四线/)
    assert.match(await p.textContent('#chPingCBox .cc-h'), /自定义目标/)
    for (const [id, want] of [
      ['chPingP', DEFAULT],
      ['chPingC', CUSTOM],
    ]) {
      const cfg = await p.$eval('#' + id, e => ({
        smooth: e._cfg.smooth,
        names: e._cfg.series.map(s => s.name),
      }))
      assert.equal(cfg.smooth, true, id + ' latency lines are smoothed')
      assert.deepEqual(
        cfg.names.map(n => (n.startsWith('Google') ? 'Google' : n)),
        want,
        id + ' draws only its own group (own scale)',
      )
    }
    const colours = await dots(p, 'chPingP')
    assert.equal(new Set(colours).size, 4, 'four distinct fixed colours')
    await p.$eval('#detCharts', e => e.scrollIntoView({ block: 'start' }))
    await p.screenshot({ path: 'qa/shots/echo-split-detail-two-boxes-1600.png', fullPage: true })

    await p.click('#detTabs [data-t="load"]')
    await p.waitForSelector('#chCpu canvas')
    assert.equal(await p.$eval('#chCpu', e => !!e._cfg.smooth), false, 'load charts keep straight segments')
    assert.equal(await p.locator('#chPingP').count(), 0)
    await p.click('#detTabs [data-t="ping"]')
    await waitChart(p)

    // The detail page no longer changes the Echo view's choice (still custom).
    await p.click('#nav a[data-p="dashboard"]')
    await p.waitForSelector('.echo-card .echo-target')
    assert.equal(await p.getAttribute('[data-echo-group="custom"]', 'aria-pressed'), 'true')
    assert.deepEqual(
      await p.locator('.echo-card').first().locator('.echo-target-name').allTextContents(),
      CUSTOM,
    )

    // A node left off the default tasks: four rows keep their slots and say why, no lines drawn.
    await p.goto(base + '/detail/demo-9?echo=preset')
    await p.waitForFunction(() => window.NM?._loaded)
    await p.click('#detTabs [data-t="ping"]')
    await waitChart(p)
    assert.equal(await p.locator('#chPingPS .card.wait').count(), 4)
    assert.match(await p.textContent('#chPingPS'), /该节点未分配/)
    assert.match(await p.textContent('#chPingP'), /默认四线暂无样本/)
    assert.equal(
      await p.$eval('#chPingPBox', e => e.classList.contains('empty')),
      true,
      'no empty 280 px chart',
    )
    assert.deepEqual(await dots(p, 'chPingP'), colours, 'same colour per line on every node')

    for (const [w, h] of [
      [390, 844],
      [320, 740],
    ]) {
      await p.setViewportSize({ width: w, height: h })
      await p.waitForTimeout(200)
      assert.equal(
        await p.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        0,
        'no overflow ' + w,
      )
    }
    await p.goto(base + '/detail/demo-2?echo=preset')
    await p.waitForFunction(() => window.NM?._loaded)
    await p.click('#detTabs [data-t="ping"]')
    await waitChart(p)
    await p.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
    await p.$eval('#detCharts', e => e.scrollIntoView({ block: 'start' }))
    await p.waitForTimeout(300)
    await p.screenshot({ path: 'qa/shots/echo-split-detail-preset-320-dark.png' })
    await p.close()
  }

  /* ── home network panel: one group only, following the Echo choice (admin setting
        「回声默认目标组」 or the visitor's Echo switch) ── */
  {
    const lamps = p =>
      p.$$eval('#homeLegend li[data-k="lamps"] b [class^="hl-"]', s =>
        s.map(x => x.textContent.replace(/ (超时|[\d.]+ ms).*$/, '')),
      )
    const waitLamps = p =>
      p.waitForFunction(() => {
        const b = document.querySelector('#homeLegend li[data-k="lamps"] b')
        return b && !/载入中/.test(b.textContent)
      })
    const p = await open('/detail/demo-2?echo=preset')
    await waitLamps(p)
    assert.match(await p.textContent('#homeLegend li[data-k="lamps"] .lamp-group'), /默认四线/)
    assert.deepEqual(await lamps(p), DEFAULT, 'default chosen: the panel shows the four default lines only')
    await p.evaluate(() => localStorage.setItem('nm-echo-group', 'custom'))
    await p.reload()
    await p.waitForFunction(() => window.NM?._loaded)
    await waitLamps(p)
    assert.match(await p.textContent('#homeLegend li[data-k="lamps"] .lamp-group'), /自定义目标/)
    assert.deepEqual(await lamps(p), CUSTOM, 'custom chosen: no default or old 「回声预设」 line')
    await p.close()
  }

  /* ── default lines not enabled (plain preview) ── */
  {
    const p = await open('/detail/demo-2')
    await p.click('#detTabs [data-t="ping"]')
    await waitChart(p)
    assert.match(await p.textContent('#chPingP'), /尚未启用默认四线/)
    assert.equal(await p.$eval('#chPingPBox', e => e.classList.contains('empty')), true)
    assert.deepEqual(await names(p, 'chPingC'), CUSTOM)

    // Ledger: one currency hides the switch; free nodes draw no cycle bar.
    await p.evaluate(() => NM.nodes.forEach(n => (n.currency = '$')))
    await p.click('#nav a[data-p="billing"]')
    await p.waitForSelector('#blBody tbody tr')
    assert.equal(
      await p.$eval('#blCurrency', e => getComputedStyle(e).display),
      'none',
      'single currency: no switch',
    )
    assert.match(
      await p.locator('tr', { hasText: 'Seattle 10' }).locator('td.ledger-cycle').innerText(),
      /^—$/,
    )
    await p.close()
  }

  assert.deepEqual(errors, [], 'no page errors')
  console.log(
    'Echo split browser: custom cards and picker exclude bound and old default lines, detail latency in two boxes (default / custom, own scales, no switch, Echo choice untouched), fixed default colours and waiting slots, smoothed latency only, not-enabled hint, home network panel one group only (default / custom), single-currency switch hidden, free node without cycle bar, 390/320 without overflow passed.',
  )
} finally {
  await browser.close()
  server.close()
}
