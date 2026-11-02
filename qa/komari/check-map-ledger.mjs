// Only a supplied loopback instance: Star Map and Ledger as a guest on a real Komari.
// Run by run-next.py (NM_MAP_LEDGER_WAIT) after check-defaults enabled the default lines and the
// scripted nodes answered Komari's tasks for a while. Those answers are simulated by reporter.py,
// so arcs here prove scheduling, storage and drawing, never reachability of the targets.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const [base, state] = process.argv.slice(2)
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/)
const clients = JSON.parse(readFileSync(state + '/clients.json', 'utf8'))
const TARGETS = ['124.237.177.164', '110.242.74.102', '111.63.65.247', '8.8.8.8']
const browser = await chromium.launch(),
  errors = [],
  failed = []
const result = {}
async function guest(path) {
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  p.on('pageerror', e => errors.push(path + ': ' + e.message))
  p.on('console', m => m.type() === 'error' && errors.push(path + ': ' + m.text()))
  p.on('response', r => r.status() >= 400 && failed.push(r.status() + ' ' + r.url()))
  const pings = []
  p.on('request', r => {
    if (!r.url().endsWith('/api/rpc2') || r.method() !== 'POST') return
    try {
      const body = JSON.parse(r.postData())
      if (body.method === 'public:queryMetrics' && body.params.metric_keys.includes('ping.latency_ms'))
        pings.push(body)
    } catch {}
  })
  await p.goto(base + path)
  await p.waitForFunction(() => window.NM?._loaded && window.NM?.lastSync)
  return { p, pings }
}
try {
  /* Ledger: nodes.py gives Seoul 05 a $5 monthly price expiring in five days; the rest have no price.
     check-defaults adds one more node ("Future default enrolment": no region, no price). */
  {
    const { p } = await guest('/billing')
    await p.waitForSelector('#blBody tbody tr')
    const rows = await p.$$eval('#blBody tbody tr', r => r.map(x => x.innerText.replace(/\s+/g, ' ')))
    const total = await p.evaluate(() => NM.nodes.filter(n => !n.hidden).length)
    assert.ok(total >= clients.length)
    assert.equal(rows.length, total)
    const seoul = rows.find(r => r.includes('Seoul 05'))
    assert.match(seoul, /月付 · \$5/)
    assert.match(seoul, /\$5\.00/)
    assert.match(seoul, /剩 [45] 天/)
    assert.equal(rows.filter(r => r.includes('未定价')).length, total - 1, 'others are unpriced')
    const tiles = await p.$$eval('#blTiles .tile', t => t.map(x => x.innerText.replace(/\s+/g, ' ')))
    assert.match(tiles[0], /\$5\.00/)
    assert.match(tiles[3], /^30 天内续费 1 ?台/)
    assert.equal(await p.locator('.cal-bar').count(), 12, 'a monthly $5 renews every month')
    result.ledger = { rows: rows.length, tiles }
    await p.screenshot({ path: 'qa/shots/beta6-real-ledger.png', fullPage: true })
    await p.close()
  }
  /* Star Map: flag regions (🇯🇵 …) locate every node; arcs follow the stored default-line samples. */
  {
    const { p, pings } = await guest('/worldmap')
    await p.waitForSelector('#mapC .sm-svg')
    assert.equal(
      await p.locator('.sm-node').count(),
      clients.length,
      'every nodes.py node placed from its region flag',
    )
    const total = await p.evaluate(() => NM.nodes.filter(n => !n.hidden).length)
    if (total > clients.length)
      assert.match(
        await p.textContent('#mapTiles'),
        new RegExp(`${total - clients.length} 个无坐标`),
        'unplaced nodes are counted, not guessed',
      )
    if (total > clients.length)
      assert.match(await p.textContent('#mapList'), /未填地区/, 'a node without region is named, not "-- --"')
    const enabled = await p.evaluate(() => !!JSON.parse(NM.ts.echo_preset_tasks || '{}').telecom)
    result.map = { enabled }
    if (enabled) {
      await p.waitForSelector('.sm-arc', { timeout: 30000 })
      const arcs = await p.$$eval('.sm-arc', a =>
        a.map(x => [x.dataset.u, x.getAttribute('class').split(' ')[1]]),
      )
      result.map.arcs = Object.fromEntries(
        arcs.map(([u, q]) => [clients.find(c => c.uuid === u)?.name || u, q]),
      )
      assert.ok(arcs.length >= clients.length - 1, 'one arc per node with default-line tasks')
      assert.ok(
        arcs.some(([, q]) => /q-(stable|unstable|lost)/.test(q)),
        'at least one arc coloured from real stored samples',
      )
      assert.match(await p.textContent('.sm-target-label'), /河北 · 三网目标/)
      assert.match(await p.textContent('#mapTiles'), /到河北三网 · 中位/)
      const id = clients.find(c => c.profile === 'idle').uuid
      await p.$eval(`a.sm-node[data-u="${id}"]`, a => a.scrollIntoView({ block: 'center' }))
      await p.waitForTimeout(150)
      await p.hover(`a.sm-node[data-u="${id}"] .sm-hit`)
      const tip = await p.evaluate(() => document.getElementById('nmTip').innerText)
      assert.match(tip, /电信 · 河北[\s\S]*联通 · 河北[\s\S]*移动 · 河北/)
      result.map.tip = tip
    }
    const text = await p.evaluate(
      () => document.body.innerText + ' ' + (document.getElementById('nmTip')?.innerText || ''),
    )
    for (const ip of TARGETS) assert.ok(!text.includes(ip), 'guest never sees target IP ' + ip)
    result.map.pingBatches = pings.length
    assert.ok(pings.length <= 1, 'direct landing reads at most one shared Echo batch: ' + pings.length)
    await p.screenshot({ path: 'qa/shots/beta6-real-map.png', fullPage: true })
    await p.close()
  }
  assert.deepEqual(errors, [], 'no page errors')
  assert.deepEqual(failed, [], 'no failed requests')
  console.log(JSON.stringify(result, null, 1))
  console.log(
    'Real Komari Map + Ledger beta.6: guest pages, flag regions placed, $ monthly calendar, default-line arcs, no target IPs, no errors passed.',
  )
} finally {
  await browser.close()
}
