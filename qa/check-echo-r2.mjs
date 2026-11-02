import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')
const browser = await chromium.launch(),
  errors = [],
  sizes = []
mkdirSync('qa/shots', { recursive: true })
try {
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  p.on('pageerror', e => errors.push(e.message))
  p.on('console', m => m.type() === 'error' && errors.push(m.text()))
  await p.goto('file://' + resolve('preview/NanoMuse-preview.html') + '#/')
  await p.waitForFunction(() => NM?.lastSync)
  assert.equal(
    await p.evaluate(() => Object.values(NM.live).filter(r => r._hasLoad).length),
    14,
    'most preview nodes report load',
  )
  assert.equal(await p.evaluate(() => NM.live['demo-7']._hasLoad), false)
  assert.equal(await p.evaluate(() => NM.live['demo-13']._hasLoad), false)
  for (const [width, height] of [
    [1600, 1000],
    [1920, 1080],
    [390, 844],
    [320, 740],
  ]) {
    await p.setViewportSize({ width, height })
    await p.click('[data-v="medium"]')
    const splits = await p.$$eval('.resource-cap', es =>
      es.flatMap(e => {
        const text = e.textContent,
          bad = []
        for (const m of text.matchAll(/[\d.]+\u00a0[A-Z]+/g)) {
          const range = document.createRange()
          range.setStart(e.firstChild, m.index)
          range.setEnd(e.firstChild, m.index + m[0].length)
          if (range.getClientRects().length !== 1) bad.push(m[0])
        }
        return bad
      }),
    )
    assert.deepEqual(splits, [], 'capacity number/unit stays together ' + width)
    await p.click('[data-v="list"]')
    await p.waitForSelector('.echo-trend svg')
    await p.waitForTimeout(120)
    const alignment = await p.$$eval('.echo-card', cards =>
      cards.flatMap(card => {
        const rows = [...card.querySelectorAll('.echo-target')]
        const r = rows.map(e => {
          const b = e.getBoundingClientRect(),
            n = e.querySelector('.echo-target-name').getBoundingClientRect(),
            v = e.querySelector('strong').getBoundingClientRect(),
            t = e.querySelector('.echo-trend').getBoundingClientRect()
          return { x: t.x - b.x, w: t.width, gap: v.x - n.right }
        })
        return r.length
          ? [
              {
                spread: Math.max(...r.map(v => v.x)) - Math.min(...r.map(v => v.x)),
                minWidth: Math.min(...r.map(v => v.w)),
                gap: r[0].gap,
                cardHeight: card.getBoundingClientRect().height,
              },
            ]
          : []
      }),
    )
    assert.ok(
      alignment.every(r => r.spread < 0.5),
      'all trend starts align ' + width,
    )
    assert.ok(
      alignment.every(r => r.gap >= 0 && r.gap <= 8),
      'latency follows fixed name column ' + width,
    )
    assert.ok(
      alignment.every(r => r.minWidth >= 90),
      'trend receives remaining real width ' + width,
    )
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      0,
      'no overflow ' + width,
    )
    assert.equal(
      await p.$$eval('.echo-trend svg', es => es.some(e => e.querySelectorAll('path').length !== 4)),
      false,
      'four paths per plot',
    )
    assert.equal(
      await p.$$eval('.echo-trend svg', es =>
        es.some(e => e.dataset.echoCells < 30 || e.dataset.echoCells > 60),
      ),
      false,
    )
    for (const theme of ['light', 'dark']) {
      await p.evaluate(theme => (document.documentElement.dataset.theme = theme), theme)
      await p.$eval('#nodes', e =>
        window.scrollTo(
          0,
          e.getBoundingClientRect().top +
            scrollY -
            document.querySelector('header.top').getBoundingClientRect().height -
            12,
        ),
      )
      await p.screenshot({ path: `qa/shots/echo-r2-${width}-${theme}.png` })
    }
    sizes.push({ width, height, alignment })
  }
  // Distinguish poor hour-long reachability from a short recent outage.
  assert.match(await p.locator('[data-u="demo-4"] .echo-target').last().textContent(), /最近连续超时/)
  assert.doesNotMatch(
    await p.locator('[data-u="demo-4"] .echo-target').last().textContent(),
    /目标可能不回应/,
  )
  assert.match(await p.locator('[data-u="demo-15"]').textContent(), /目标可能不回应/)
  const requests = await p.evaluate(
    () =>
      previewRequests.filter(
        r => r.method === 'public:queryMetrics' && r.params.metric_keys.includes('ping.latency_ms'),
      ).length,
  )
  await p.setViewportSize({ width: 1600, height: 1000 })
  await p.waitForTimeout(150)
  assert.equal(
    await p.evaluate(
      () =>
        previewRequests.filter(
          r => r.method === 'public:queryMetrics' && r.params.metric_keys.includes('ping.latency_ms'),
        ).length,
    ),
    requests,
    'resizing does not fetch probes',
  )
  // Inject only QA history into the already public mock cache, then remount Echo.
  await p.evaluate(() => {
    const now = Date.now(),
      start = now - 3600000
    const row = (id, name, lat) => ({
      id,
      name,
      points: Array.from({ length: 30 }, (_, i) => ({ t: start + i * 120000 + 30000, lat, loss: 0 })),
      avg: lat,
      loss: 0,
      last: { t: now - 1000, lat, loss: 0 },
    })
    const rows = [
      row(901, '远处稳定的洛杉矶线路', 180),
      row(902, '近处稳定', 30),
      row(903, '部分丢包', 30),
      row(904, '无数据', 30),
    ]
    rows[2].points[10].loss = 0.25
    rows[2].loss = 0.8
    rows[3].points = []
    rows[3].last = null
    rows[3].avg = null
    rows[3].loss = null
    NM.echo.entries['demo-0'] = { at: now, tasks: rows, configured: true }
  })
  await p.click('[data-v="medium"]')
  await p.click('[data-v="list"]')
  await p.waitForTimeout(150)
  const stable = p.locator('[data-u="demo-0"] .echo-target').first()
  assert.equal(
    await stable.locator('.echo-bars-unstable').getAttribute('d'),
    '',
    'far stable line is not amber',
  )
  assert.equal(await stable.locator('.echo-bars-lost').getAttribute('d'), '')
  assert.ok(await stable.locator('.echo-bars-stable').getAttribute('d'))
  assert.equal(
    await stable.locator('.echo-bars-stable').evaluate(e => getComputedStyle(e).stroke),
    await p.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--cyan')
        .trim()
        .replace(
          /^#([0-9a-f]{6})$/i,
          (_, hex) => 'rgb(' + [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')',
        ),
    ),
    'stable strokes use the theme cyan',
  )
  assert.ok(
    await p.locator('[data-u="demo-0"] .echo-target').nth(2).locator('.echo-bars-unstable').getAttribute('d'),
  )
  assert.ok(
    await p.locator('[data-u="demo-0"] .echo-target').nth(3).locator('.echo-bars-missing').getAttribute('d'),
  )
  const before = await stable.locator('svg').getAttribute('viewBox')
  await p.setViewportSize({ width: 1100, height: 1000 })
  await p.waitForTimeout(150)
  assert.notEqual(
    await stable.locator('svg').getAttribute('viewBox'),
    before,
    'ResizeObserver uses actual chart width',
  )
  await p.click('[data-echo-group="preset"]')
  assert.equal(
    await p.$$eval('.echo-card', es => es.some(e => /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(e.innerText))),
    false,
    'waiting cards remain IP-free',
  )
  assert.ok(
    await p.locator('.echo-preset-empty .echo-bars-missing').first().getAttribute('d'),
    'waiting cells are grey frames',
  )
  await p.close()
  // The HTTP live fallback carries exactly the same preview load values and missing groups.
  const poll = await browser.newPage()
  poll.on('pageerror', e => errors.push(e.message))
  await poll.goto('file://' + resolve('preview/NanoMuse-preview.html') + '?scenario=nows#/')
  await poll.waitForFunction(() => NM?.liveVia === 'poll' && NM?.lastSync)
  assert.equal(await poll.evaluate(() => Object.values(NM.live).filter(r => r._hasLoad).length), 14)
  assert.equal(await poll.evaluate(() => NM.live['demo-0'].load1), 0.12)
  await poll.close()
  assert.deepEqual(errors, [])
  writeFileSync('qa/shots/echo-r2-layout.json', JSON.stringify(sizes, null, 2) + '\n')
  console.log(
    'Echo r2: fixed columns, aligned thin plots, light/dark at 1600/1920/390/320, grey waits, honest hints, capacity units, shared resize cache and preview load/socket-poll parity passed.',
  )
} finally {
  await browser.close()
}
