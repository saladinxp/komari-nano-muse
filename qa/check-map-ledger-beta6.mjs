// 2.1.0-beta.6 browser check: Star Map 「回声星图」 and Ledger 「续费日历」 on the built theme
// (dist/) with the preview fixtures. Mock data only: arcs reflect mock samples, not reachability.
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
const report = { ledger: {}, map: {}, shots: [] }

async function open(path, width = 1600, height = 1000) {
  const p = await browser.newPage({ viewport: { width, height } })
  p.on('pageerror', e => errors.push(path + ': ' + e.message))
  p.on('console', m => m.type() === 'error' && errors.push(path + ': ' + m.text()))
  await p.addInitScript({ content: readFileSync('qa/fixtures.js', 'utf8') })
  await p.goto(base + path)
  await p.waitForFunction(() => window.NM?.lastSync && window.NM?._loaded)
  return p
}
const noOverflow = async (p, label) =>
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    0,
    'no overflow ' + label,
  )
const tipText = p =>
  p.evaluate(() =>
    document.getElementById('nmTip')?.hidden ? '' : document.getElementById('nmTip').innerText,
  )
const pingBatches = p =>
  p.evaluate(
    () =>
      previewRequests.filter(
        r =>
          r.method === 'public:queryMetrics' &&
          r.params.metric_keys.includes('ping.latency_ms') &&
          r.params.metric_keys.includes('ping.loss') &&
          r.params.max_points === 60,
      ).length,
  )
async function shoot(p, name, widths) {
  for (const [w, h] of widths) {
    await p.setViewportSize({ width: w, height: h })
    await p.waitForTimeout(250)
    await noOverflow(p, `${name} ${w}`)
    for (const theme of ['light', 'dark']) {
      await p.evaluate(t => (document.documentElement.dataset.theme = t), theme)
      await p.waitForTimeout(300)
      const file = `qa/shots/map-ledger-beta6-${name}-${w}-${theme}.png`
      await p.screenshot({ path: file, fullPage: true })
      report.shots.push(file)
    }
  }
  await p.evaluate(() => (document.documentElement.dataset.theme = 'light'))
}
const SIZES = [
  [1600, 1000],
  [1920, 1080],
  [390, 844],
  [320, 740],
]

try {
  /* ── Ledger ── */
  {
    const p = await open('/billing')
    await p.waitForSelector('#blCalendar .cal-svg')
    // Independent expectation from the fixture nodes (Komari bands → months).
    const want = await p.evaluate(() => {
      const months = d =>
        d >= 27 && d <= 32
          ? 1
          : d >= 87 && d <= 95
            ? 3
            : d >= 175 && d <= 185
              ? 6
              : d >= 360 && d <= 370
                ? 12
                : d >= 720 && d <= 750
                  ? 24
                  : null
      const day = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5
      const today = day(new Date())
      const monthly = {}
      let soon = 0,
        expired = []
      for (const n of NM.nodes) {
        const m = months(Number(n.billing_cycle)),
          exp = n.expired_at && new Date(n.expired_at).getFullYear() > 2000 ? new Date(n.expired_at) : null,
          dd = exp ? day(exp) - today : null
        if (n.price > 0 && m) monthly[n.currency] = (monthly[n.currency] || 0) + n.price / m
        if (dd != null && dd < 0) expired.push(n.name)
        if (n.price > 0 && m && dd != null && dd >= 0 && dd <= 30) soon++
      }
      return { monthly, soon, expired }
    })
    const tiles = await p.$$eval('#blTiles .tile', ts => ts.map(t => t.innerText.replace(/\s+/g, ' ')))
    // Letter codes keep a space; symbols (Komari's default '$') sit against the number.
    const fmt = (c, a) => (/^[A-Za-z]{2,}$/.test(c) ? `${c} ${a}` : c + a)
    for (const [cur, v] of Object.entries(want.monthly)) {
      assert.ok(
        tiles[0].includes(fmt(cur, v.toFixed(2))),
        `monthly ${fmt(cur, v.toFixed(2))} in "${tiles[0]}"`,
      )
      assert.ok(tiles[1].includes(fmt(cur, (v * 12).toFixed(0))), `annual keeps ${cur}: "${tiles[1]}"`)
    }
    assert.deepEqual(Object.keys(want.monthly).sort(), ['$', '¥', '€'], 'three currencies, none converted')
    assert.match(tiles[3], new RegExp(`^30 天内续费 ${want.soon} ?台`), tiles[3])
    assert.ok(tiles[3].includes('已过期 1 台另计'), 'expired counted apart')
    assert.deepEqual(want.expired, ['Paris 14'])
    assert.match(tiles[2], /下次续费 \d\d-\d\d \d+ 天后 · Taipei 06 · \$26/, tiles[2])
    report.ledger.tiles = tiles

    assert.equal(await p.locator('.cal-slot').count(), 12, '12 months at 1600')
    assert.ok((await p.locator('.cal-value').count()) <= 2, 'only next and highest labelled')
    assert.equal(
      await p.locator('.cal-bar').evaluateAll(b => new Set(b.map(x => getComputedStyle(x).fill)).size),
      1,
      'one colour',
    )
    await p.$eval('#blCalendar', e => e.scrollIntoView({ block: 'center' }))
    await p.waitForTimeout(150)
    await p.hover('.cal-slot[data-i="0"] .cal-hit')
    assert.match(await tipText(p), /Taipei 06 · 手动/, 'calendar hover lists nodes, manual / automatic')
    await p.keyboard.press('Escape')
    await p.focus('.cal-slot[data-i="4"]')
    assert.match(await tipText(p), /年 \d+ 月/, 'calendar focus shows the month card')
    await p.click('#blCurrency button[data-cur="¥"]')
    assert.match(await p.textContent('#blCalSub'), /¥/)
    assert.match(await p.textContent('#blMixSub'), /¥/)
    assert.equal(await p.getAttribute('#blCurrency button[data-cur="¥"]', 'aria-pressed'), 'true')
    await p.click('#blCurrency button[data-cur="$"]')

    const pcts = await p.$$eval('.mix-legend em', e => e.map(x => parseInt(x.textContent)))
    assert.equal(
      pcts.reduce((a, b) => a + b, 0),
      100,
    )
    assert.ok(pcts.length <= 4, 'at most 3 groups + 其他')
    const gap = await p.$$eval(
      '.mix-seg',
      s => s.length > 1 && s[1].getBoundingClientRect().left - s[0].getBoundingClientRect().right,
    )
    assert.ok(Math.abs(gap - 2) < 0.6, '2 px between segments: ' + gap)
    await p.$eval('.mix-bar', e => e.scrollIntoView({ block: 'center' }))
    await p.waitForTimeout(150)
    await p.hover('.mix-seg >> nth=0')
    assert.match(await tipText(p), /%/)

    assert.equal(await p.locator('#blBody tbody tr').count(), 16)
    const heads = await p.$$eval('#blBody th', t => t.map(x => x.textContent))
    assert.deepEqual(heads, ['节点', '周期 · 价格', '月均', '到期', '本周期', '每核月均'])
    assert.equal(await p.locator('tr.is-expired').count(), 1)
    assert.equal(await p.locator('tr.is-soon').count(), 4)
    assert.match(
      await p.locator('tr', { hasText: 'Tokyo 01' }).innerText(),
      /年付 · \$48[\s\S]*\$4\.00[\s\S]*剩 \d+ 天 ?自动续费[\s\S]*本周期已用 \d+%[\s\S]*\$1\.00 \/ 核 · 月/,
    )
    assert.match(await p.locator('tr', { hasText: 'Osaka 02' }).innerText(), /月付 · ¥15[\s\S]*手动续费/)
    assert.match(await p.locator('tr', { hasText: 'Paris 14' }).innerText(), /已过期 3 天/)
    assert.match(await p.locator('tr', { hasText: 'Seattle 10' }).innerText(), /免费[\s\S]*长期/)
    await p.click('#blSort [data-s="region"]')
    assert.match(await p.locator('#blBody tbody tr').first().innerText(), /Sydney 15/)
    await p.click('#blSort [data-s="cost"]')
    assert.match(
      await p.locator('#blBody tbody tr').first().innerText(),
      /Hong Kong 04/,
      '¥29.33 is the largest monthly number (amounts are compared as numbers only for sorting)',
    )
    await p.click('#blSort [data-s="exp"]')
    assert.match(await p.locator('#blBody tbody tr').first().innerText(), /Paris 14/)

    for (const [w, h] of [
      [390, 844],
      [320, 740],
    ]) {
      await p.setViewportSize({ width: w, height: h })
      await p.waitForTimeout(250)
      await noOverflow(p, 'ledger ' + w)
      assert.equal(await p.locator('.cal-slot').count(), 6, '6 months on phones')
      assert.equal(
        await p.$eval('#blBody thead', e => getComputedStyle(e).display),
        'none',
        'cards, not a table',
      )
      assert.equal(
        await p.$eval('#blTiles', e => getComputedStyle(e).gridTemplateColumns.split(' ').length),
        2,
        '2 × 2 totals',
      )
    }
    await shoot(p, 'ledger', SIZES)
    await p.close()
  }

  /* ── Star Map: default lines not enabled → dots only ── */
  {
    const p = await open('/worldmap')
    await p.waitForSelector('#mapC .sm-svg')
    assert.equal(await p.locator('.sm-arc').count(), 0)
    assert.equal(await p.locator('.sm-node').count(), 16)
    assert.match(await p.textContent('#mapCaption'), /未启用回声默认四线/)
    assert.match(await p.textContent('#mapTiles'), /未启用默认四线/)
    assert.equal(await pingBatches(p), 0, 'no Echo request when there is nothing to draw')
    await p.evaluate(() => previewScenario('pingerror'))
    await p.waitForTimeout(400)
    assert.equal(await p.locator('.sm-arc').count(), 0)
    report.map.defaultLines = 'dots only'
    await p.close()
  }

  /* ── Star Map: default lines enabled (mock samples) ── */
  {
    const p = await open('/worldmap?echo=preset')
    await p.waitForSelector('#mapC .sm-arc')
    const arcs = await p.$$eval('.sm-arc', a =>
      Object.fromEntries(a.map(x => [x.dataset.u, x.getAttribute('class').split(' ')[1]])),
    )
    report.map.arcs = arcs
    assert.equal(Object.keys(arcs).length, 15, 'Seattle 10 is not on the preset tasks: dot only')
    assert.equal(arcs['demo-9'], undefined)
    assert.equal(arcs['demo-14'], 'q-lost', 'Sydney: all three lines lost')
    assert.equal(arcs['demo-15'], 'q-offline', 'Toronto offline')
    assert.equal(arcs['demo-2'], 'q-unstable', 'Singapore: partial loss on one line')
    assert.equal(arcs['demo-4'], 'q-unstable', 'Seoul: one carrier failing now')
    assert.equal(arcs['demo-7'], 'q-unstable', 'San Jose: latency spikes')
    assert.equal(arcs['demo-0'], 'q-stable')
    assert.match(await p.textContent('#mapTiles'), /到河北三网 · 中位\s*\d+\s*ms/)
    assert.equal(await p.locator('.sm-target').count(), 1)
    assert.match(await p.textContent('.sm-target-label'), /河北 · 三网目标/)
    const boxes = await p.evaluate(() => ({
      labels: [...document.querySelectorAll('.sm-label, .sm-target-label')].map(t => {
        const b = t.getBBox()
        return { text: t.textContent, x: b.x, y: b.y, w: b.width, h: b.height }
      }),
      dots: [...document.querySelectorAll('.sm-dot')].map(c => ({
        x: +c.getAttribute('cx'),
        y: +c.getAttribute('cy'),
      })),
      svg: document.querySelector('.sm-svg').getBoundingClientRect().toJSON(),
    }))
    const hit = (a, b) =>
      a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5
    for (const [i, a] of boxes.labels.entries()) {
      for (const b of boxes.labels.slice(i + 1)) assert.ok(!hit(a, b), `"${a.text}" overlaps "${b.text}"`)
      for (const d of boxes.dots)
        assert.ok(!hit(a, { x: d.x - 3.6, y: d.y - 3.6, w: 7.2, h: 7.2 }), `"${a.text}" covers a dot`)
    }
    assert.ok(
      boxes.labels.some(l => /^(DE|NL|GB|FR)( · (DE|NL|GB|FR)){3} 4$/.test(l.text)),
      'Europe merged into one label',
    )
    assert.ok(Math.abs(boxes.svg.width / boxes.svg.height - 2.3) < 0.35, 'about 2.3 : 1')
    report.map.labels = boxes.labels.map(l => l.text)

    // Cards close on scroll by design, so bring the node into view before hovering.
    // A fixture live frame also rebuilds the map. Freeze that unrelated frame only
    // while asserting hover/focus content, then resume the live fixture.
    await p.evaluate(() => {
      const receive = NM.ws.onmessage
      window.resumeMapFrames = () => (NM.ws.onmessage = receive)
      NM.ws.onmessage = () => {}
    })
    await p.$eval('a.sm-node[data-u="demo-14"]', a =>
      a.scrollIntoView({ block: 'center', behavior: 'instant' }),
    )
    await p.waitForTimeout(150)
    await p.mouse.move(0, 0)
    // locator.hover() may issue a second scroll for an SVG circle; that queued
    // scroll correctly closes the tooltip. Move the real pointer after our scroll.
    const nodeBox = await p.locator('a.sm-node[data-u="demo-14"] .sm-hit').boundingBox()
    await p.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2)
    await p.waitForFunction(
      () =>
        !document.getElementById('nmTip')?.hidden &&
        /Sydney 15/.test(document.getElementById('nmTip').textContent),
    )
    const tip = await tipText(p)
    assert.match(tip, /Sydney 15[\s\S]*电信 · 河北[\s\S]*联通 · 河北[\s\S]*移动 · 河北[\s\S]*CPU/)
    assert.match(tip, /100% 丢包/)
    await p.keyboard.press('Escape')
    assert.equal(await tipText(p), '')
    assert.equal(
      await p.$eval('a.sm-node[data-u="demo-2"]', a => a.tabIndex),
      0,
      'nodes are in the tab order',
    )
    await p.$eval('a.sm-node[data-u="demo-2"]', a => a.focus({ preventScroll: true }))
    assert.match(await tipText(p), /Singapore 03/)
    await p.evaluate(() => window.resumeMapFrames())

    const cards = await p.$$eval('.sm-region', c =>
      c.map(x => ({ top: x.getBoundingClientRect().top, left: x.getBoundingClientRect().left })),
    )
    assert.equal(cards.length, 12)
    assert.ok(
      cards.slice(1, 4).every(c => Math.abs(c.top - cards[0].top) < 1) && cards[4].top > cards[0].top + 10,
      '4 per row at 1600',
    )
    assert.equal(
      await p.evaluate(
        () =>
          [...document.querySelectorAll('#pg-worldmap *')].filter(
            e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1,
          ).length,
      ),
      0,
      'nothing scrolls inside a frame',
    )

    // One shared batch: direct landing asks once; overview and back within the minute ask nothing.
    const first = await pingBatches(p)
    assert.equal(first, 1, 'landing on the map loads the shared Echo batch once')
    await p.click('#nav a[data-p="dashboard"]')
    await p.waitForTimeout(600)
    await p.click('#nav a[data-p="worldmap"]')
    await p.waitForSelector('#mapC .sm-arc')
    assert.equal(await pingBatches(p), first, 'overview ↔ map within 60 s reuse the cache')
    const before = await p.$eval('.sm-svg', s => s.getAttribute('width'))
    await p.setViewportSize({ width: 1200, height: 900 })
    await p.waitForTimeout(300)
    assert.notEqual(await p.$eval('.sm-svg', s => s.getAttribute('width')), before, 'redrawn on resize')
    assert.equal(await pingBatches(p), first, 'resize asks nothing')
    report.map.pingBatches = first

    for (const [w, h] of [
      [390, 844],
      [320, 740],
    ]) {
      await p.setViewportSize({ width: w, height: h })
      await p.waitForTimeout(300)
      await noOverflow(p, 'map ' + w)
      assert.equal(await p.locator('.sm-label').count(), 0, 'no text labels on phones')
      assert.equal(await p.locator('.sm-target-label').count(), 0)
      assert.ok((await p.locator('.sm-arc').count()) > 0)
      assert.equal(
        await p.$eval('#mapTiles', e => getComputedStyle(e).gridTemplateColumns.split(' ').length),
        2,
        '2 × 2 totals',
      )
      const lefts = await p.$$eval(
        '.sm-region',
        c => new Set(c.map(x => Math.round(x.getBoundingClientRect().left))).size,
      )
      assert.equal(lefts, 1, 'one column of region cards')
    }
    await shoot(p, 'map', SIZES)
    await p.close()
  }

  assert.deepEqual(errors, [], 'no page errors')
  writeFileSync('qa/shots/map-ledger-beta6.json', JSON.stringify(report, null, 2))
  console.log(
    'Map + Ledger beta.6 browser: multi-currency totals and annual, 30-day without expired, 12/6-month calendar with two labels, ' +
      'currency switch, composition 100% + 2px gaps, six-column table and phone cards, three sorts; map dots-only without default lines, ' +
      '15 arcs coloured stable/unstable/lost/offline, Seattle dot-only, merged non-overlapping labels, hover + keyboard cards, ' +
      '4-per-row regions, one shared Echo batch, resize redraw without requests, 1600/1920/390/320 light/dark passed.',
  )
} finally {
  await browser.close()
  server.close()
}
