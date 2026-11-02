// Second acceptance pass on local Komari: behaviours that need time (idle errands, visits,
// leader calls, loss events). Keeps the duty room open and samples it for a few minutes.
// Usage: node qa/komari/accept-time.mjs http://127.0.0.1:25774 <state>/clients.json qa/shots 4
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const [base, clientsFile, out, minutes = '3'] = process.argv.slice(2)
const clients = JSON.parse(readFileSync(clientsFile, 'utf8'))
const id = name => clients.find(c => c.name === name).uuid
const browser = await chromium.launch()
const problems = []
const watch = (p, tag) => {
  p.on('pageerror', e => problems.push(tag + ' pageerror ' + e.message))
  p.on('console', m => m.type() === 'error' && problems.push(tag + ' console ' + m.text()))
  p.on('response', r => r.status() >= 400 && problems.push(tag + ' HTTP ' + r.status() + ' ' + r.url()))
}
const text = (p, sel) => p.textContent(sel).then(t => (t || '').replace(/\s+/g, ' ').trim())
try {
  /* Toronto: offline but probes assigned */
  const t = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  watch(t, 'toronto')
  await t.goto(base + '/detail/' + id('Toronto 16'))
  await t.waitForTimeout(6000)
  console.log('Toronto lamps:', (await text(t, '#homeLegend')).match(/网络面板[^座]*/)?.[0])
  await t.close()

  /* Osaka home (idle owner, maybe a guest) */
  const o = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  watch(o, 'osaka')
  await o.goto(base + '/detail/' + id('Osaka 02'))
  await o.waitForTimeout(7000)
  console.log('Osaka home:', (await text(o, '#homeLegend')).slice(0, 120))
  await o.screenshot({ path: `${out}/real-osaka-home.png` })
  await o.close()

  /* duty room, Japan room then the whole floor, sampled over time */
  const d = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  watch(d, 'duty')
  await d.goto(base + '/duty')
  await d.waitForTimeout(5000)
  const seen = new Set()
  const end = Date.now() + +minutes * 60_000
  let n = 0
  while (Date.now() < end) {
    const roster = await text(d, '#dutyRoster')
    const states =
      roster.match(/(Tokyo 01|Osaka 02|Singapore 03|Seoul 05|London 13|Amsterdam 12|Toronto 16)[^0-9]+/g) ||
      []
    states.forEach(s => seen.add(s.trim()))
    if (n % 6 === 0) await (await d.$('#dutyCanvas')).screenshot({ path: `${out}/real-duty-t${n}.png` })
    n++
    await d.waitForTimeout(5000)
  }
  console.log('roster states seen:\n  ' + [...seen].sort().join('\n  '))
  console.log('duty log:', (await text(d, '#dutyLog')).slice(0, 700))
  console.log('book:', await text(d, '#dutyBookCount'))
  await d.close()

  const h = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  watch(h, 'home')
  await h.goto(base + '/')
  await h.waitForTimeout(6000)
  console.log('signal log:', (await text(h, '#signalList')).slice(0, 500))
  await h.close()
} finally {
  await browser.close()
}
console.log('\nproblems:', problems.length ? '\n' + [...new Set(problems)].join('\n') : 'none')
