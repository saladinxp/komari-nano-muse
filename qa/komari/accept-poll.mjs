// The theme behind a proxy whose WebSocket fails (qa/komari/proxy.mjs): live data must
// still arrive, over `common:getNodesLatestStatus`, on the dashboard, in the duty room and on a
// detail page; and the same readings as a direct (socket) page.
// Usage: node qa/komari/accept-poll.mjs http://127.0.0.1:25780 http://127.0.0.1:25774 <state>/clients.json qa/shots
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const [proxied, direct, clientsFile, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const clients = JSON.parse(readFileSync(clientsFile, 'utf8'))
const id = name => clients.find(c => c.name === name).uuid
const browser = await chromium.launch()
const problems = []
const report = (k, v) => console.log(k.padEnd(28), v)

async function open(base, path) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const ws = []
  page.on('pageerror', e => problems.push(path + ' pageerror ' + e.message))
  page.on('websocket', s => ws.push(s.url()))
  page.on('response', r => r.status() >= 400 && problems.push(path + ' HTTP ' + r.status() + ' ' + r.url()))
  const rpc = []
  page.on('request', r => {
    if (r.url().endsWith('/api/rpc2') && r.method() === 'POST') rpc.push(JSON.parse(r.postData()).method)
  })
  page.rpc = rpc
  page.ws = ws
  await page.goto(base + path)
  await page.waitForTimeout(8000)
  return page
}
const text = (p, sel) => p.textContent(sel).then(t => (t || '').replace(/\s+/g, ' ').trim())
const snapshot = p =>
  p.evaluate(() => ({
    via: window.NM.liveVia,
    online: [...window.NM.online].sort(),
    mem: Object.fromEntries(Object.entries(window.NM.live).map(([k, v]) => [k, v.mem_total])),
  }))

try {
  const home = await open(proxied, '/')
  report('live indicator (proxied)', await text(home, '#liveTxt'))
  report('live title', await home.getAttribute('#live', 'title'))
  report('kicker', await text(home, '#kickerTxt'))
  report('polls in 8 s', home.rpc.filter(m => m === 'common:getNodesLatestStatus').length)
  report('socket attempts', home.ws.length)
  const viaProxy = await snapshot(home)
  await home.screenshot({ path: `${out}/real-poll-home.png` })
  await home.close()

  const ref = await open(direct, '/')
  report('live indicator (direct)', await text(ref, '#liveTxt'))
  const viaSocket = await snapshot(ref)
  report('same online set', JSON.stringify(viaProxy.online) === JSON.stringify(viaSocket.online))
  report('same memory totals', JSON.stringify(viaProxy.mem) === JSON.stringify(viaSocket.mem))
  await ref.close()

  const duty = await open(proxied, '/duty')
  report('duty meta (proxied)', await text(duty, '#dutyRoomMeta'))
  report('duty roster (proxied)', (await text(duty, '#dutyRoster')).slice(0, 240))
  await (await duty.$('#dutyCanvas')).screenshot({ path: `${out}/real-poll-duty.png` })
  await duty.close()

  const det = await open(proxied, '/detail/' + id('Seoul 05'))
  for (const k of ['chCpuN', 'chRamN', 'chDiskN']) report('detail ' + k, await text(det, '#' + k))
  report('home legend', (await text(det, '#homeLegend')).slice(0, 200))
  await det.close()
} finally {
  await browser.close()
}
report('problems', problems.length ? problems.join('\n') : 'none')
