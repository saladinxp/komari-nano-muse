// 2.1.1-beta.4 browser check: node tags in Komari colours on the Star Core cards and the
// node detail head, light and dark, on the built theme (dist/) with the preview fixtures.
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

const chips = (p, sel) =>
  p.$$eval(sel, els =>
    els.map(s => [s.textContent.trim(), s.classList.contains('tag-c'), getComputedStyle(s).color]),
  )

try {
  for (const mode of ['light', 'dark']) {
    // Tokyo 01 (demo-0) carries "10Gbps<green>;2T<blue>;NVMe" in the fixtures.
    const p = await open('/')
    await p.evaluate(m => localStorage.setItem('nm-mode', m), mode)
    await p.evaluate(() => localStorage.setItem('nm-view', 'large'))
    await p.reload()
    await p.waitForFunction(() => window.NM?.lastSync && document.querySelector('.core-tags'))
    const card = (await chips(p, '.core-tags span')).slice(0, 3)
    assert.deepEqual(
      card.map(c => [c[0], c[1]]),
      [
        ['10Gbps', true],
        ['2T', true],
        ['NVMe', false],
      ],
      mode + ' card tags',
    )
    const green = mode === 'light' ? 'rgb(33, 131, 88)' : 'rgb(61, 214, 140)',
      blue = mode === 'light' ? 'rgb(13, 116, 206)' : 'rgb(112, 184, 255)'
    assert.equal(card[0][2], green, mode + ' green')
    assert.equal(card[1][2], blue, mode + ' blue')
    await p.goto(base + '/detail/demo-0')
    await p.waitForFunction(() => document.querySelector('#detMeta .det-tag'))
    const head = await chips(p, '#detMeta .det-tag')
    assert.deepEqual(
      head.map(c => [c[0], c[1]]),
      [
        ['10Gbps', true],
        ['2T', true],
        ['NVMe', false],
      ],
      mode + ' detail tags',
    )
    assert.equal(head[0][2], green, mode + ' detail green')
    assert.ok(!(await p.textContent('#detMeta')).includes('<'), 'no raw <colour> left')
    await p.close()
  }
  // Osaka 02: "Production<Red>;Beta<nope>" — case-insensitive name, unknown name stays text.
  const q = await open('/detail/demo-1')
  await q.waitForFunction(() => document.querySelector('#detMeta .det-tag'))
  assert.deepEqual(
    (await chips(q, '#detMeta .det-tag')).map(c => [c[0], c[1]]),
    [
      ['Production', true],
      ['Beta<nope>', false],
    ],
  )
  await q.close()
  assert.deepEqual(errors, [], 'no page errors')
  console.log(
    'Tags: Komari colours on Star Core cards and the detail head, light and dark, case and unknown names, no errors passed.',
  )
} finally {
  await browser.close()
  server.close()
}
