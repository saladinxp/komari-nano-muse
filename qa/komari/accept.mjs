// Acceptance pass of the installed NanoMuse theme on a local Komari server.
// Usage: node qa/komari/accept.mjs http://127.0.0.1:25774 <state>/clients.json qa/shots
import { readFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const [base, clientsFile, out] = process.argv.slice(2)
mkdirSync(out, { recursive: true })
const clients = JSON.parse(readFileSync(clientsFile, 'utf8'))
const id = name => clients.find(c => c.name === name).uuid
const browser = await chromium.launch()
const problems = []
const report = (k, v) => console.log(k.padEnd(28), v)

async function open(path, opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, ...opts })
  page.on('pageerror', e => problems.push(path + ' pageerror ' + e.message))
  page.on('console', m => m.type() === 'error' && problems.push(path + ' console ' + m.text()))
  page.on('response', r => r.status() >= 400 && problems.push(path + ' HTTP ' + r.status() + ' ' + r.url()))
  const rpc = [],
    assets = []
  page.on('request', r => {
    if (r.url().includes('/scene-art/')) assets.push(r.url())
    if (r.url().endsWith('/api/rpc2') && r.method() === 'POST') rpc.push(JSON.parse(r.postData()).method)
  })
  page.rpc = rpc
  page.assets = assets
  await page.goto(base + path)
  await page.waitForTimeout(6000)
  return page
}
const text = (p, sel) => p.textContent(sel).then(t => (t || '').replace(/\s+/g, ' ').trim())

try {
  /* overview */
  const home = await open('/')
  report('live indicator', await text(home, '#liveTxt'))
  report('node cards', await home.$$eval('#nodes .nc', l => l.length))
  report('signal log hidden', await home.$eval('#signalLog', e => e.hidden))
  report('signal entries', (await text(home, '#signalList')).slice(0, 160))
  report('footer', (await text(home, 'footer')).slice(0, 100))
  report('rpc methods', [...new Set(home.rpc)].join(', '))
  await home.screenshot({ path: `${out}/real-home.png`, fullPage: true })
  /* echo view */
  const echoBtn = await home.$('#viewSeg [data-v="list"]')
  if (echoBtn) {
    await echoBtn.click()
    await home.waitForTimeout(4000)
    report('echo targets', (await text(home, '#nodes')).match(/本机 (TCP|HTTP)/g)?.length || 0)
    await home.screenshot({ path: `${out}/real-echo.png`, fullPage: true })
  } else report('echo button', 'not found')
  await home.close()

  /* duty room */
  const duty = await open('/duty')
  report(
    'duty tabs',
    (await duty.$$eval('#dutyFloor [data-room]', b => b.map(x => x.textContent.trim()))).join(' | '),
  )
  report('chair assets loaded', duty.assets.filter(a => a.includes('/chair-')).length)
  if (!duty.assets.some(a => a.includes('/chair-empty.webp'))) problems.push('duty chair asset not requested')
  report('duty roster', await duty.$$eval('#dutyRoster li', l => l.length))
  report('duty meta', await text(duty, '#dutyRoomMeta'))
  report('duty roster text', (await text(duty, '#dutyRoster')).slice(0, 300))
  await (await duty.$('#dutyCanvas')).screenshot({ path: `${out}/real-duty.png` })
  await duty.close()

  /* node details: scripted high-memory node and the real agent */
  for (const name of ['Seoul 05', 'Tokyo 01', 'London 13', 'Toronto 16']) {
    const d = await open('/detail/' + id(name))
    await d.waitForTimeout(3000)
    const val = sel => d.$eval(sel, e => e.textContent.trim()).catch(() => '(none)')
    report(
      name + ' charts',
      `cpu ${await val('#chCpuN')} · ram ${await val('#chRamN')} · disk ${await val('#chDiskN')}`,
    )
    report(
      name + ' home',
      (await text(d, '#homeHead')) + ' / ' + (await text(d, '#homeLegend')).slice(0, 220),
    )
    report(name + ' queryMetrics', d.rpc.filter(m => m === 'public:queryMetrics').length + ' calls')
    await d.screenshot({ path: `${out}/real-detail-${name.replace(' ', '')}.png`, fullPage: true })
    await d.close()
  }

  for (const path of ['/traffic', '/stability', '/worldmap', '/billing']) {
    const p = await open(path)
    report(path, (await text(p, 'main')).slice(0, 120))
    await p.screenshot({ path: `${out}/real${path.replace('/', '-')}.png`, fullPage: true })
    await p.close()
  }

  /* phone width */
  const phone = await open('/', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  report(
    'phone overflow px',
    await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  )
  await phone.close()
} finally {
  await browser.close()
}
console.log('\nproblems:', problems.length ? '\n' + [...new Set(problems)].join('\n') : 'none')
