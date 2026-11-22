// 2.1.1-beta.2 browser check: the home desk on the home-comfort chair and the room at night with
// the dark colour scheme, on the built theme (dist/) with the preview fixtures.
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
  /* The light-scheme checks expect daytime: shift the page clock to 14:00 today. */
  await p.addInitScript(() => {
    const Real = Date,
      at = new Real()
    at.setHours(14, 0, 0, 0)
    const shift = at.getTime() - Real.now()
    class Shifted extends Real {
      constructor(...a) {
        super(...(a.length ? a : [Real.now() + shift]))
      }
      static now() {
        return Real.now() + shift
      }
    }
    window.Date = Shifted
  })
  await p.goto(base + path)
  await p.waitForFunction(() => window.NM?.lastSync && window.NM?._loaded)
  return p
}

/* Scene-art files the page fetched, by name. */
const fetched = p =>
  p.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map(e => new URL(e.name).pathname.split('/').pop())
      .filter(n => n.endsWith('.webp')),
  )
const legend = (p, k) => p.$eval(`#homeLegend [data-k="${k}"] b`, b => b.textContent)

try {
  // Singapore 03 (demo-2) is at work: CPU alert in the fixtures. Light scheme at 14:00.
  const p = await open('/detail/demo-2')
  await p.waitForFunction(() => document.querySelector('#homeLegend [data-k="window"]'))
  await p.waitForTimeout(1500)
  let files = await fetched(p)
  assert.ok(files.includes('home-chair-day.webp'), 'day chair loaded')
  assert.ok(!files.some(f => f.startsWith('desk-')), 'no stool atlas fetched: ' + files.join(' '))
  assert.ok(
    files.some(f => f.startsWith('chair-worker-')),
    'stool-free worker loaded',
  )
  const light = await p.evaluate(() => document.documentElement.dataset.theme)
  assert.equal(light, 'light')
  assert.match(await legend(p, 'window'), /按你的本地时间/)

  // Switch to the dark scheme with the header button: night room, night chair, note says so.
  for (let i = 0; i < 3 && (await p.evaluate(() => document.documentElement.dataset.theme)) !== 'dark'; i++)
    await p.click('#modeBtn')
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark')
  await p.waitForTimeout(1500)
  files = await fetched(p)
  assert.ok(files.includes('home-night.webp'), 'night room loaded in the dark scheme')
  assert.ok(files.includes('home-chair-night.webp'), 'night chair loaded in the dark scheme')
  await p.waitForFunction(
    () => /深色配色/.test(document.querySelector('#homeLegend [data-k="window"] b')?.textContent || ''),
    null,
    { timeout: 15000 },
  )
  await p.screenshot({ path: 'qa/shots/home-chair-dark.png' })
  await p.close()

  // Away from the desk (Tokyo 01 idles on the sofa in the fixtures): the chair stays as an empty chair.
  const q = await open('/detail/demo-0')
  await q.waitForTimeout(2500)
  assert.ok((await fetched(q)).includes('home-chair-day.webp'), 'empty chair drawn while away')
  await q.screenshot({ path: 'qa/shots/home-chair-empty.png' })
  await q.close()

  assert.deepEqual(errors, [], 'no page errors')
  console.log(
    'Home chair: day chair with stool-free worker, no stool atlas, dark scheme → night room and night chair with the note, empty chair while away, no errors passed.',
  )
} finally {
  await browser.close()
  server.close()
}
