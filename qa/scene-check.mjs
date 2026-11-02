// Drive the duty room and the home office in the offline preview; screenshots go to qa/shots/duty-*.png and home-*.png.
// Checks: no page errors, rooms and roster render, selecting a worker fills the side panel,
// switching rooms swaps the room type, dark mode uses the night room, phone width has no
// horizontal scroll. With LONG=1 it also waits through the preview's event loop
// (spike → leader call, offline → recover, reboot) and checks the log and the moment book.
// Run `npm run build` first.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const { chromium } = createRequire(import.meta.url)('playwright')
const out = 'qa/shots'
mkdirSync(out, { recursive: true })
const base = 'file://' + resolve('preview/NanoMuse-preview.html') + '#',
  file = base + '/duty'
const browser = await chromium.launch()
const errors = []
const open = async (opts = {}, url = file) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, ...opts })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  await page.goto(url)
  await page.waitForTimeout(2500)
  return page
}
const shot = (page, name, full = true) => page.screenshot({ path: `${out}/duty-${name}.png`, fullPage: full })

try {
  const page = await open()
  const tabs = await page.$$eval('#dutyFloor [data-room]', b => b.map(x => x.textContent))
  assert.ok(tabs.length >= 2 && tabs[0].startsWith('全员'), 'floor tabs: ' + tabs.join(' | '))
  assert.equal(await page.$$eval('#dutyRoster li', l => l.length), 16, '16 desks in the whole-floor room')
  assert.match(await page.textContent('#dutyRoomMeta'), /大值班室 · 16 工位/)
  await shot(page, 'floor')

  await page.click('#dutyRoster [data-pick="demo-2"]')
  await page.waitForTimeout(400)
  assert.match(await page.textContent('#dutyPick'), /Singapore 03/)
  assert.match(await page.textContent('#dutyPick'), /CPU/)
  await page.click('#dutyPick [data-cast="seina"]')
  await page.waitForTimeout(400)
  assert.match(await page.textContent('#dutyPick'), /星奈/)
  await shot(page, 'selected', false)

  await page.click('#dutyFloor [data-room="g:亚洲"]')
  await page.waitForTimeout(800)
  assert.match(await page.textContent('#dutyRoomMeta'), /中值班室 · 8 工位 · \d\/4 在岗 · 空位 4/)
  await shot(page, 'asia', false)
  await page.click('#dutyFloor [data-room="g:日本"]')
  await page.waitForTimeout(800)
  assert.match(await page.textContent('#dutyRoomMeta'), /小值班室 · 3 工位/)
  await page.click('#dutyFloor [data-room="all"]')

  if (process.env.LONG) {
    await page.waitForTimeout(90_000)
    const log = await page.textContent('#dutyLog')
    for (const k of ['来活了', '领导来电', '趴桌睡着', '揉眼归队', '重启头晕', '带薪摸鱼'])
      assert.ok(log.includes(k), 'log has ' + k)
    await shot(page, 'events')
  }
  console.log('book:', await page.textContent('#dutyBookCount'))
  await page.close()

  const dark = await open({ colorScheme: 'dark' })
  await dark.evaluate(() => document.getElementById('modeBtn').click())
  await dark.evaluate(
    () => document.documentElement.dataset.theme !== 'dark' && document.getElementById('modeBtn').click(),
  )
  await dark.waitForTimeout(1500)
  await shot(dark, 'dark', false)
  await dark.close()

  const phone = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  assert.ok(overflow <= 0, 'no horizontal scroll on phones, got ' + overflow)
  await shot(phone, 'phone')
  await phone.close()

  /* a visit: with every roll at 0.7 an idle worker in the Japan room goes to chat with the other */
  const chat = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  chat.on('pageerror', e => errors.push(e.message))
  await chat.addInitScript(() => (Math.random = () => 0.7))
  await chat.goto(file)
  await chat.waitForTimeout(2500)
  await chat.click('#dutyFloor [data-room="g:日本"]')
  await chat.waitForTimeout(4000)
  assert.deepEqual(
    await chat.evaluate(() => ['demo-0', 'demo-1'].map(u => window.__NM_APP__.dutyWhere(u))),
    ['chat', 'chat'],
    'the two idle colleagues are chatting',
  )
  await chat.$eval('#dutyCanvas', c => c.scrollIntoView())
  await (await chat.$('#dutyCanvas')).screenshot({ path: `${out}/duty-visit.png` })
  await chat.close()

  /* home page signal log */
  const front = await open({}, base + '/')
  assert.equal(await front.$eval('#signalLog', e => e.hidden), false, 'signal log shown')
  assert.match(await front.textContent('#signalList'), /Toronto 16 信号中断/)
  /* the mock settings carry a stale saved version tag ('v2.1.0-design.7'): the footer ignores it */
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.equal(await front.textContent('#fVer'), 'v' + version, 'footer shows the real version')
  assert.equal(
    await front.evaluate(() => window.NM.ts.version_tag),
    'v2.1.0-design.7',
    'stale setting remains in the fixture',
  )
  const motion = await front.evaluate(() => ({
    sides: [...document.querySelectorAll('.ambient svg')].map(e => getComputedStyle(e).animationName),
    easing: [...document.querySelectorAll('.halo .h-spin')].map(
      e => getComputedStyle(e).animationTimingFunction,
    ),
  }))
  assert.deepEqual(motion.sides, ['none', 'none'], 'side wireframes really stop in the cascade')
  assert.deepEqual(motion.easing, ['steps(560)', 'steps(360)'], 'halo runs at four steps per second')
  await front.evaluate(() => (location.hash = '#/duty'))
  await front.waitForTimeout(400)
  assert.equal(await front.$eval('.surface-aurora', e => e.dataset.active), 'false', 'offscreen aurora stops')
  assert.deepEqual(
    await front.$$eval('.halo .h-spin', es => es.map(e => getComputedStyle(e).animationPlayState)),
    ['paused', 'paused'],
    'offscreen halo pauses',
  )
  await front.close()

  const customTitle = await open(
    {},
    'file://' +
      resolve('preview/NanoMuse-preview.html') +
      '?title=' +
      encodeURIComponent('纳米观测站') +
      '#/',
  )
  for (const id of ['heroTitle', 'brandName']) {
    assert.equal(
      await customTitle.$eval('#' + id, e => e.classList.contains('system-title')),
      true,
      id + ' uses one whole-title fallback',
    )
    assert.equal(
      await customTitle.$eval('#' + id, e => getComputedStyle(e).fontFamily.includes('NanoMuse Title')),
      false,
      id + ' does not mix in the six-glyph font',
    )
  }
  await customTitle.close()

  /* reverse proxy that refuses the WebSocket: the page polls getNodesLatestStatus instead,
     and the dashboard and the duty room fill from those frames */
  const nows = await open({}, 'file://' + resolve('preview/NanoMuse-preview.html') + '?scenario=nows#/')
  await nows.waitForTimeout(2500)
  assert.equal(await nows.textContent('#liveTxt'), '轮询更新')
  assert.match(await nows.textContent('#kickerTxt'), /最近同步 .* 16 台节点 \/ 1 台离线/)
  assert.ok(
    await nows.evaluate(
      () =>
        window.previewRequests.filter(r => r.method === 'common:getNodesLatestStatus').length >= 2 &&
        window.NM.online.size === 15 &&
        window.NM.live['demo-4'].mem_used > 0,
    ),
    'polled repeatedly, online set and readings filled',
  )
  await nows.evaluate(() => (location.hash = '#/duty'))
  await nows.waitForTimeout(2500)
  assert.match(await nows.textContent('#dutyRoomMeta'), /大值班室 · 16 工位 · 1[45]\/16 在岗/)
  await nows.close()

  /* phone hero: the character has its own band above the title, so the title never covers her */
  const hero = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }, base + '/')
  const [orbitBottom, titleTop] = await hero.evaluate(() => [
    document.getElementById('orbit').getBoundingClientRect().bottom,
    document.querySelector('.hero h1').getBoundingClientRect().top,
  ])
  assert.ok(titleTop >= orbitBottom, `phone title (${titleTop}) below the character (${orbitBottom})`)
  await hero.screenshot({ path: `${out}/home-hero-phone.png` })
  await hero.close()

  /* detail charts: current Komari has no memory.total / disk.total metric and its legacy records
     carry zero totals, so the memory and disk percentages must come from the node's capacity */
  const det = await open({}, base + '/detail/demo-0')
  const pctOf = id => det.textContent('#' + id + 'N')
  for (const id of ['chCpu', 'chRam', 'chDisk'])
    assert.match(await pctOf(id), /\d%$/, id + ' via metric store')
  assert.ok(
    !(await det.evaluate(() =>
      window.previewRequests.some(r => r.method === 'public:queryMetrics' && r.error),
    )),
    'no rejected metric queries',
  )
  await det.evaluate(() => window.previewScenario('legacy'))
  await det.waitForTimeout(1500)
  for (const id of ['chRam', 'chDisk']) assert.match(await pctOf(id), /\d%$/, id + ' via legacy records')
  await det.close()

  /* home office */
  const home = await open({}, base + '/detail/demo-0')
  const legend = () => home.textContent('#homeLegend')
  assert.match(await home.textContent('#homeHead'), /的家/)
  assert.match(await legend(), /盆栽已运行 23d .*小苗/)
  assert.match(await legend(), /零食柜流量已用 7% · 满/)
  assert.match(await legend(), /网络面板自定义目标北京联通/)
  await home.waitForTimeout(3500)
  assert.match(await legend(), /串门Osaka 02/, 'idle neighbour from the same group visits')
  assert.match(await legend(), /在沙发上|出门了/, 'idle owner leaves the desk')
  await home.screenshot({ path: `${out}/home-idle.png` })
  const visit = async (id, re, name) => {
    await home.evaluate(h => (location.hash = h), '#/detail/' + id)
    await home.waitForTimeout(2500)
    assert.match(await legend(), re, id)
    await home.screenshot({ path: `${out}/home-${name}.png` })
  }
  await visit('demo-5', /挂历.*剩 6 天 · 房租快到期/, 'expiry')
  await visit('demo-12', /零食柜流量已用 92% · 空/, 'traffic')
  await visit('demo-15', /显示器停电/, 'offline')
  await visit('demo-11', /盆栽.*开花/, 'bloom')
  await visit('demo-2', /显示器CPU 8\d/, 'busy')
  assert.match(await legend(), /阿橘坐在书桌前埋头苦干/, 'busy owner works at the desk')
  await visit('demo-4', /坐在书桌前打字/, 'desk')
  await home.close()
  const phoneHome = await open(
    { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
    base + '/detail/demo-0',
  )
  const over = await phoneHome.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  assert.ok(over <= 0, 'home: no horizontal scroll on phones, got ' + over)
  await phoneHome.screenshot({ path: `${out}/home-phone.png`, fullPage: true })
  await phoneHome.close()

  assert.deepEqual(errors, [], 'page errors')
  console.log('scene-check: ok')
} finally {
  await browser.close()
}
