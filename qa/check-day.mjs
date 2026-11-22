// 2.1.1-beta.5 browser check: the traffic page's "最近 24 小时" panel (usage Top 5, average CPU /
// memory), the 24 h line and sort on node cards, an old Komari without the metric store, phone width.
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

const rows = (p, id) =>
  p.$$eval(`#${id} > li:not(.day-wait)`, els =>
    els.map(li => ({
      name: li.querySelector('a')?.textContent,
      value: li.querySelector('b')?.textContent.replace(/\s+/g, ' ').trim(),
      peak: li.querySelector('.day-row > small')?.textContent,
      bar: parseFloat(li.querySelector('.day-bar')?.style.width),
    })),
  )
const GB = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }
const bytes = t => {
  const m = /([\d.]+)\s*(B|KB|MB|GB|TB)/.exec(t)
  return m ? +m[1] * GB[m[2]] : NaN
}

try {
  const p = await open('/traffic')
  await p.waitForFunction(
    () => document.querySelectorAll('#dayUsage > li:not(.day-wait)').length === 5,
    null,
    {
      timeout: 15000,
    },
  )
  // one query, Komari's aggregation: traffic summed, cpu / memory averaged, 500 buckets over 24 h
  const q = await p.evaluate(() =>
    window.previewRequests.find(
      r => r.method === 'public:queryMetrics' && r.params.metric_keys.includes('traffic.up'),
    ),
  )
  assert.equal(q.params.hours, 24)
  assert.equal(q.params.max_points, 500)
  assert.equal(q.params.aggregation_by_metric['traffic.up'], 'sum')
  assert.equal(q.params.aggregation_by_metric['cpu.usage'], 'avg')

  const usage = await rows(p, 'dayUsage')
  assert.equal(usage[0].name, 'London 13', 'the heaviest node leads')
  assert.equal(usage[0].bar, 100)
  for (let i = 1; i < usage.length; i++)
    assert.ok(usage[i].bar <= usage[i - 1].bar, 'bars shrink down the list')
  for (const u of usage) {
    assert.match(u.value, /↑ [\d.]+ (GB|TB|MB)\s*↓ [\d.]+ (GB|TB|MB)/)
    assert.match(u.peak, /^峰值 [\d.]+ (MB|KB|GB)\/s · (今天|昨天) \d\d:\d\d$/)
  }
  const sum = await p.textContent('#daySum')
  assert.match(sum, /全部节点合计↑ [\d.]+ TB\s+↓ [\d.]+ TB/)

  for (const id of ['dayCpu', 'dayMem']) {
    const list = await rows(p, id)
    assert.equal(list.length, 5, id)
    for (let i = 1; i < list.length; i++)
      assert.ok(parseFloat(list[i].value) <= parseFloat(list[i - 1].value), id + ' sorted')
    for (const r of list) assert.match(r.peak, /^峰值 [\d.]+% · (今天|昨天) \d\d:\d\d$/)
  }
  // memory past 75 % of the 80 % alert threshold turns amber
  assert.ok(await p.$eval('#dayMem .day-bar', b => b.classList.contains('w') || b.classList.contains('h')))

  // node cards: a 24 h line, and the sort by 24 h usage puts London 13 first
  assert.match(await p.textContent('[data-traffic-k="du"]'), /^↑ 24h [\d.]+ (GB|TB|MB)$/)
  await p.selectOption('#trafficSort', 'day')
  await p.waitForTimeout(200)
  assert.equal(await p.textContent('#trafficNodes .traffic-node-head a'), 'London 13')
  const cards = await p.$$eval('#trafficNodes .traffic-node', els =>
    els.map(e => [
      e.querySelector('[data-traffic-k="du"]').textContent,
      e.querySelector('[data-traffic-k="dd"]').textContent,
    ]),
  )
  const totals = cards.map(([u, d]) => bytes(u) + bytes(d))
  // displayed values are rounded, so allow the rounding of two numbers
  for (let i = 1; i < totals.length; i++) assert.ok(totals[i] <= totals[i - 1] * 1.02, 'cards in 24 h order')

  // the group filter narrows the panel too
  const groups = await p.$$eval('#trafficGroup option', o => o.map(x => x.value).filter(v => v !== 'ALL'))
  await p.selectOption('#trafficGroup', groups[0])
  await p.waitForTimeout(200)
  const shown = new Set(await p.$$eval('#trafficNodes .traffic-node-head a', a => a.map(x => x.textContent)))
  for (const u of await rows(p, 'dayUsage')) assert.ok(shown.has(u.name), u.name + ' is in the chosen group')
  await p.screenshot({ path: 'qa/shots/traffic-day.png', fullPage: false })
  await p.close()

  // an old Komari without the metric store: a plain note, no numbers
  const legacy = await open('/traffic?scenario=legacy')
  await legacy.waitForFunction(
    () => /未提供/.test(document.querySelector('#dayUsage')?.textContent || ''),
    null,
    {
      timeout: 15000,
    },
  )
  assert.match(await legacy.textContent('#dayNote'), /指标存储/)
  await legacy.close()

  // phone width: one column, nothing wider than the screen
  const m = await open('/traffic', 390, 844)
  await m.waitForFunction(() => document.querySelectorAll('#dayUsage > li:not(.day-wait)').length === 5)
  assert.ok((await m.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'no sideways scroll')
  await m.close()

  assert.deepEqual(errors, [], 'no page errors')
  console.log(
    'Traffic 24 h: one aggregated query, usage Top 5 with peaks, average CPU / memory, node-card line and sort, group filter, old Komari note, phone width, no errors passed.',
  )
} finally {
  await browser.close()
  server.close()
}
