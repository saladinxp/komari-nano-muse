// Only a supplied loopback instance: verify real agent readings in the installed Core view.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const [base, clientsFile] = process.argv.slice(2)
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/)
const clients = JSON.parse(readFileSync(clientsFile, 'utf8')),
  real = clients.find(c => c.profile === 'real')
const browser = await chromium.launch(),
  errors = []
try {
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  p.on('pageerror', e => errors.push(e.message))
  p.on('console', m => m.type() === 'error' && errors.push(m.text()))
  await p.goto(base + '/')
  await p.waitForFunction(id => NM?.online?.has(id), real.uuid)
  await p.click('[data-v="large"]')
  const check = await p.evaluate(id => {
    const live = NM.live[id],
      card = document.querySelector(`[data-u="${id}"]`),
      text = card.querySelector('[data-core-facts]').textContent
    return {
      known: [live._hasLoad, live._hasConnections, live._hasProcess],
      load: live.load1.toFixed(2),
      tcp: live.tcp,
      udp: live.udp,
      process: live.process,
      text,
      height: card.getBoundingClientRect().height,
      swap: live.swap_total,
    }
  }, real.uuid)
  assert.deepEqual(check.known, [true, true, true])
  assert.ok(check.text.includes(check.load))
  assert.ok(check.text.includes(check.tcp + ' / ' + check.udp))
  assert.ok(check.text.includes(String(check.process)))
  if (!check.swap) assert.doesNotMatch(check.text, /Swap/)
  assert.ok(check.height <= 380, 'real agent compact card ' + check.height)
  await p.$eval('#nodes', e => window.scrollTo(0, e.getBoundingClientRect().top + scrollY - 95))
  await p.screenshot({ path: 'qa/shots/beta4-real-core.png' })
  assert.deepEqual(errors, [])
  console.log(
    'Real Komari Core: live agent load/connections/process, Swap=0 omission, compact height and no browser errors passed.',
  )
} finally {
  await browser.close()
}
