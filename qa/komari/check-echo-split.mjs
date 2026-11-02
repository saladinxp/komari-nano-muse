// Guest-only, on an installed candidate in a local real Komari. Reporter samples
// prove the API/storage/render path, not public target reachability.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const [base, state] = process.argv.slice(2)
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/)
const clients = JSON.parse(readFileSync(state + '/clients.json', 'utf8')),
  node = clients.find(c => c.profile === 'busy'),
  expected = ['电信 · 河北', '联通 · 河北', '移动 · 河北', 'Google'],
  browser = await chromium.launch(),
  errors = [],
  result = { instance: 'local real Komari', probe_values: 'scripted responses, not reachability' }
try {
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  p.on('pageerror', e => errors.push(e.message))
  await p.goto(base + '/detail/' + encodeURIComponent(node.uuid))
  await p.waitForFunction(() => window.NM?._loaded && window.NM?.lastSync)
  await p.click('#detTabs [data-t="ping"]')
  // Both groups in their own boxes, no switch.
  await p.waitForSelector('#chPingP canvas')
  await p.waitForFunction(() => document.querySelector('#chPingP')._cfg?.series.length === 4)
  await p.waitForFunction(() => document.querySelector('#chPingC')._cfg?.series[0]?.name === '本机 TCP')
  assert.equal(await p.locator('#detGroup').count(), 0)
  const defaults = await p.$eval('#chPingP', h => ({
    names: h._cfg.series.map(s => s.name),
    smooth: h._cfg.smooth,
    samples: h._cfg.series.map(s => s.pts.filter(p => p[1] != null).length),
  }))
  assert.deepEqual(defaults.names, expected)
  assert.equal(defaults.smooth, true)
  assert.ok(
    defaults.samples.every(n => n > 0),
    'stored results for every bound default line',
  )
  await p.$eval('#detCharts', e => e.scrollIntoView({ block: 'start' }))
  await p.screenshot({ path: 'qa/shots/beta7-real-preset.png', fullPage: true })
  const custom = await p.$eval('#chPingC', h => ({
    names: h._cfg.series.map(s => s.name),
    smooth: h._cfg.smooth,
    samples: h._cfg.series.map(s => s.pts.filter(p => p[1] != null).length),
  }))
  assert.deepEqual(custom.names, ['本机 TCP', '本机 HTTP'])
  assert.equal(custom.smooth, true)
  assert.ok(custom.samples.every(n => n > 0))
  for (const width of [390, 320]) {
    await p.setViewportSize({ width, height: 844 })
    await p.waitForTimeout(250)
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
  }
  await p.screenshot({ path: 'qa/shots/beta7-real-custom-320.png', fullPage: true })
  await p.click('#detTabs [data-t="load"]')
  await p.waitForSelector('#chCpu canvas')
  assert.equal(await p.$eval('#chCpu', h => !!h._cfg.smooth), false)
  assert.deepEqual(errors, [])
  Object.assign(result, { defaults, custom, errors, status: 'PASS' })
  writeFileSync('qa/shots/beta7-real-split.json', JSON.stringify(result, null, 2) + '\n')
  console.log(
    'Local installed beta.7 split: fixed default lines, custom-only targets, smoothing flag, stored samples, load unchanged and mobile width: PASS',
  )
} finally {
  await browser.close()
}
