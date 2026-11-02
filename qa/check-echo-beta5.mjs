// Browser integration with explicit mock histories; no network reachability claims.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve, extname } from 'node:path'
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
const browser = await chromium.launch(),
  errors = [],
  layouts = []
const page = async (admin = false) => {
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  p.on('pageerror', e => errors.push(e.message))
  p.on('console', m => m.type() === 'error' && errors.push(m.text()))
  await p.addInitScript({ content: readFileSync('qa/fixtures.js', 'utf8') })
  await p.goto(base + (admin ? '/?admin=1' : '/'))
  await p.waitForFunction(() => NM?.lastSync)
  await p.click('[data-v="list"]')
  await p.waitForSelector('.echo-trend svg')
  return p
}
const remount = async p => {
  await p.click('[data-v="medium"]')
  await p.click('[data-v="list"]')
  await p.waitForTimeout(150)
}
const scrollNodes = p =>
  p.$eval('#nodes', e =>
    window.scrollTo(
      0,
      e.getBoundingClientRect().top +
        scrollY -
        document.querySelector('header.top').getBoundingClientRect().height -
        12,
    ),
  )
try {
  const p = await page()
  await p.evaluate(() => {
    const keys = ['telecom', 'unicom', 'mobile', 'google'],
      names = ['电信 · 北京', '联通 · 北京', '移动 · 北京', 'Google']
    NM.ts.echo_preset_tasks = JSON.stringify(Object.fromEntries(keys.map((k, i) => [k, 101 + i])))
    delete NM.ts.echo_preset_targets
    for (const e of Object.values(NM.echo.entries)) {
      const original = e.tasks
      e.tasks = keys.map((k, i) => ({
        ...original[i % original.length],
        id: 101 + i,
        name: '回声预设 · ' + names[i],
      }))
      e.at = Date.now()
    }
  })
  await p.click('[data-echo-group="preset"]')
  await remount(p)
  assert.equal(await p.locator('.echo-card').first().locator('.echo-preset-empty').count(), 3)
  assert.equal(
    await p
      .locator('.echo-card')
      .first()
      .locator('.echo-wait')
      .filter({ hasText: '待管理员更新目标' })
      .count(),
    3,
  )
  assert.equal(
    await p
      .locator('.echo-card')
      .first()
      .locator('.echo-target')
      .last()
      .locator('.echo-preset-empty')
      .count(),
    0,
  )
  assert.ok(
    await p
      .locator('.echo-card')
      .first()
      .locator('.echo-target')
      .last()
      .locator('.echo-bars-stable')
      .getAttribute('d'),
    'Google history survives migration',
  )
  assert.equal(await p.locator('#echoPresetAdmin').isVisible(), false)
  assert.equal(
    await p.$$eval('.echo-card', es =>
      es.some(e =>
        /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(
          e.innerText + ' ' + [...e.querySelectorAll('[title]')].map(t => t.title).join(' '),
        ),
      ),
    ),
    false,
    'guest cards and titles never reveal target addresses',
  )
  await scrollNodes(p)
  await p.screenshot({ path: 'qa/shots/echo-beta5-beta3-migration-1600.png' })
  await p.evaluate(() => {
    NM.ts.echo_preset_targets = JSON.stringify({
      telecom: '219.141.136.10',
      unicom: '202.106.0.20',
      mobile: '221.179.155.161',
      google: '8.8.8.8',
    })
  })
  await remount(p)
  assert.equal(
    await p.locator('.echo-card').first().locator('.echo-preset-empty').count(),
    0,
    'explicit beta.4 targets retain data',
  )
  assert.deepEqual(await p.locator('.echo-card').first().locator('.echo-target-name').allTextContents(), [
    '电信',
    '联通',
    '移动',
    'Google',
  ])
  await p.evaluate(() => {
    NM.ts.echo_preset_targets = JSON.stringify({
      telecom: '124.237.177.164',
      unicom: '110.242.74.102',
      mobile: '111.63.65.247',
      google: '8.8.8.8',
    })
    const names = ['电信 · 河北', '联通 · 河北', '移动 · 河北', 'Google']
    for (const e of Object.values(NM.echo.entries))
      e.tasks.forEach((t, i) => (t.name = '回声预设 · ' + names[i]))
  })
  await remount(p)
  assert.deepEqual(await p.locator('.echo-card').first().locator('.echo-target-name').allTextContents(), [
    '电信 · 河北',
    '联通 · 河北',
    '移动 · 河北',
    'Google',
  ])
  for (const [width, height] of [
    [1600, 1000],
    [1920, 1080],
    [390, 844],
    [320, 740],
  ]) {
    await p.setViewportSize({ width, height })
    await p.waitForTimeout(150)
    const layout = await p.$$eval('.echo-card', cards =>
      cards.map(c => {
        const xs = [...c.querySelectorAll('.echo-trend')].map(e => e.getBoundingClientRect().x)
        return { height: c.getBoundingClientRect().height, spread: Math.max(...xs) - Math.min(...xs) }
      }),
    )
    assert.ok(
      layout.every(c => c.spread < 0.5),
      'fixed trend starts ' + width,
    )
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      0,
      'no overflow ' + width,
    )
    layouts.push({ width, height, cards: layout })
    if (width !== 320)
      for (const theme of ['light', 'dark']) {
        await p.evaluate(theme => (document.documentElement.dataset.theme = theme), theme)
        await p.waitForTimeout(500)
        await scrollNodes(p)
        await p.screenshot({ path: `qa/shots/echo-beta5-${width}-${theme}.png` })
      }
  }
  // beta.7: default lines never appear under 自定义目标 (here every task is a default line).
  await p.click('[data-echo-group="custom"]')
  assert.equal(await p.locator('.echo-card').first().locator('.echo-target').count(), 0)
  assert.match(await p.locator('.echo-card').first().textContent(), /还没有自定义目标/)
  await p.click('[data-echo-group="preset"]')
  assert.deepEqual(await p.locator('.echo-card').first().locator('.echo-target-name').allTextContents(), [
    '电信 · 河北',
    '联通 · 河北',
    '移动 · 河北',
    'Google',
  ])
  assert.equal(
    await p.locator('.echo-card').first().locator('.echo-target-name').first().getAttribute('title'),
    '回声预设 · 电信 · 河北',
    'full backend name remains in title',
  )
  await p.setViewportSize({ width: 2560, height: 1440 })
  await p.evaluate(() => {
    const now = Date.now(),
      task = NM.echo.entries['demo-0'].tasks[0]
    task.interval = 300
    task.bucketSeconds = 60
    task.points = Array.from({ length: 12 }, (_, i) => ({
      t: Math.floor((now - 3600000 + i * 300000) / 60000) * 60000,
      lat: 180,
      loss: 0,
    }))
    task.samples = task.points
    task.last = task.points.at(-1)
    task.loss = 0
    task.avg = 180
  })
  await remount(p)
  const long = p.locator('[data-u="demo-0"] .echo-target').first()
  assert.equal(await long.locator('svg').getAttribute('data-echo-cells'), '12')
  assert.equal(
    await long.locator('.echo-bars-missing').getAttribute('d'),
    '',
    'five-minute task has no invented gaps',
  )
  assert.equal(await long.locator('.echo-bars-unstable').getAttribute('d'), '', 'far stable task stays cyan')
  const mutations = await p.evaluate(() =>
    previewRequests.filter(r => r.method?.startsWith('admin:') || r.path.startsWith('/api/admin/')),
  )
  assert.equal(mutations.length, 0)
  await p.close()

  const a = await page(true)
  await a.click('#echoPresetAdmin summary')
  assert.equal(await a.locator('#echoPresetVerification').isVisible(), false)
  await a.fill('#echoTarget-telecom', '192.0.2.10')
  assert.equal(await a.locator('#echoPresetVerification').isVisible(), true)
  await a.click('#echoReviewPresets')
  assert.match(await a.textContent('#echoPresetStatus'), /大陆.*境外.*验证/)
  assert.equal(await a.locator('#echoPresetReview table').count(), 0)
  await a.check('#echoTargetsVerified')
  await a.click('#echoReviewPresets')
  await a.waitForSelector('#echoPresetReview table')
  assert.doesNotMatch(await a.locator('#echoPresetReview tbody tr').first().textContent(), /河北/)
  await a.fill('#echoTarget-telecom', '192.0.2.11')
  assert.equal(await a.isChecked('#echoTargetsVerified'), false, 'editing a target invalidates verification')
  assert.equal(await a.locator('#echoEnablePresets').isVisible(), false)
  for (const target of ['219.141.136.10', '202.106.0.20']) {
    await a.fill('#echoTarget-telecom', target)
    await a.check('#echoTargetsVerified')
    await a.click('#echoReviewPresets')
    assert.match(await a.textContent('#echoPresetStatus'), /失效旧地址/)
  }
  await a.fill('#echoTarget-telecom', '124.237.177.164')
  assert.equal(await a.locator('#echoPresetVerification').isVisible(), false)
  await a.click('#echoReviewPresets')
  await a.waitForSelector('#echoPresetReview table')
  assert.equal(
    await a.isChecked('#echoTargetsVerified'),
    false,
    'built-in review succeeds without verification checkbox',
  )
  assert.doesNotMatch(
    await a.textContent('#echoPresetAdmin'),
    /219\.141\.136\.12|202\.106\.50\.1|155\.102\.180\.202/,
  )
  assert.equal(
    await a.evaluate(() => previewRequests.filter(r => r.method === 'admin:addPingTask').length),
    0,
    'all reviews and rejected edits are read-only',
  )
  await a.close()
  assert.deepEqual(errors, [])
  writeFileSync('qa/shots/echo-beta5-layout.json', JSON.stringify(layouts, null, 2) + '\n')
  console.log(
    'Echo beta.5 browser: beta.3 guest migration, retained explicit beta.4 targets, four Hebei/Google rows, fixed layouts/light-dark at 1600/1920/390/320, default lines kept out of custom, 300s cells, built-in/custom verification and read-only review passed.',
  )
} finally {
  await browser.close()
  server.closeAllConnections()
  await new Promise(r => server.close(r))
}
