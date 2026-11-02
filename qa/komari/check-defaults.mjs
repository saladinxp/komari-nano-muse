// Run only against an explicitly supplied local acceptance instance.
// Candidate addresses here exercise task scheduling only. The real agent is stopped
// before this script; this does not assert mainland/overseas reachability.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
const { chromium } = createRequire(import.meta.url)('playwright')
const [base, state, beta3Zip] = process.argv.slice(2)
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/)
const login = JSON.parse(readFileSync(state + '/admin.json', 'utf8'))
const browser = await chromium.launch(),
  errors = []
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const auth = await context.request.post(base + '/api/login', { data: login })
  assert.equal(auth.ok(), true)
  const rpc = async (method, params = {}) => {
    const r = await context.request.post(base + '/api/rpc2', {
      data: { jsonrpc: '2.0', id: 1, method, params },
    })
    const j = await r.json()
    assert.equal(j.error, undefined)
    return j.result
  }
  const pub = async () => {
    const j = await (await context.request.get(base + '/api/public')).json()
    return j.data || j
  }
  const nodeReply = await (await context.request.get(base + '/api/nodes')).json()
  const nodes = nodeReply.data || nodeReply
  const legacy = [
    ['telecom', '电信 · 北京', '219.141.136.10'],
    ['unicom', '联通 · 北京', '202.106.0.20'],
    ['mobile', '移动 · 北京', '221.179.155.161'],
    ['google', 'Google', '8.8.8.8'],
  ]
  let oldIds = {}
  if (beta3Zip) {
    const upload = zip => {
      const result = spawnSync('bash', ['qa/komari/upload-theme.sh', zip, state], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
    }
    upload(beta3Zip)
    const clean = (await pub()).theme_settings
    delete clean.echo_preset_tasks
    delete clean.echo_preset_targets
    await context.request.post(base + '/api/admin/theme/settings?theme=NanoMuse', { data: clean })
    const old = await context.newPage()
    await old.goto(base + '/?qa=beta3')
    await old.waitForSelector('#nodes .nc')
    await old.click('[data-v="list"]')
    await old.click('#echoPresetAdmin summary')
    await old.click('#echoEnablePresets')
    await old.waitForFunction(() =>
      document.getElementById('echoPresetStatus').textContent.includes('已启用'),
    )
    const saved = (await pub()).theme_settings
    oldIds = JSON.parse(saved.echo_preset_tasks)
    assert.equal(saved.echo_preset_targets, undefined, 'beta.3 actually persists IDs only')
    await old.close()
    upload('release/nanomuse-2.1.0-beta.5.zip')
    assert.deepEqual(
      JSON.parse((await pub()).theme_settings.echo_preset_targets || '{}'),
      {},
      'upload preserves ID-only settings; beta.5 may fill its empty default object',
    )
    console.log(
      'Real upgrade: installed beta.3, enabled all four through its UI, then uploaded beta.5; ID-only settings preserved.',
    )
  } else {
    for (const [key, name, target] of legacy) {
      const added = await rpc('admin:addPingTask', {
        name: '回声预设 · ' + name,
        target,
        type: 'icmp',
        interval: 60,
        clients: nodes.map(n => n.uuid),
        default_on: true,
      })
      oldIds[key] = added.task_id
    }
  }
  const before = await rpc('admin:getAllPingTasks')
  const settings = (await pub()).theme_settings
  settings.qa_preserve = 'existing setting'
  settings.echo_preset_tasks = JSON.stringify(oldIds)
  delete settings.echo_preset_targets
  await context.request.post(base + '/api/admin/theme/settings?theme=NanoMuse', { data: settings })
  const migratedGuest = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await migratedGuest.goto(base + '/')
  await migratedGuest.waitForSelector('#nodes .nc')
  await migratedGuest.click('[data-v="list"]')
  await migratedGuest.waitForFunction(() => document.querySelectorAll('.echo-card .echo-wait').length >= 4)
  assert.equal(
    await migratedGuest
      .locator('.echo-card')
      .first()
      .locator('.echo-wait')
      .filter({ hasText: '待管理员更新目标' })
      .count(),
    3,
  )
  assert.doesNotMatch(
    await migratedGuest.locator('.echo-card').first().locator('.echo-target').last().textContent(),
    /待管理员更新目标/,
  )
  assert.equal(
    await migratedGuest.$$eval('.echo-card', es =>
      es.some(e => /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(e.innerText)),
    ),
    false,
  )
  await migratedGuest.$eval('#nodes', e =>
    window.scrollTo(
      0,
      e.getBoundingClientRect().top +
        scrollY -
        document.querySelector('header.top').getBoundingClientRect().height -
        12,
    ),
  )
  await migratedGuest.screenshot({
    path: 'qa/shots/echo-beta5-real-migration.jpg',
    type: 'jpeg',
    quality: 80,
  })
  await migratedGuest.close()
  const p = await context.newPage()
  p.on('pageerror', e => errors.push(e.message))
  p.on('console', m => m.type() === 'error' && errors.push(m.text()))
  await p.goto(base + '/')
  await p.waitForSelector('#nodes .nc')
  await p.click('[data-v="list"]')
  await p.click('#echoPresetAdmin summary')
  assert.equal(await p.inputValue('#echoTarget-telecom'), '124.237.177.164')
  assert.equal(await p.inputValue('#echoTarget-unicom'), '110.242.74.102')
  assert.equal(await p.inputValue('#echoTarget-mobile'), '111.63.65.247')
  assert.equal(await p.locator('#echoPresetVerification').isVisible(), false)
  await p.click('#echoReviewPresets')
  await p.waitForSelector('#echoPresetReview table')
  assert.match(await p.textContent('#echoPresetReview'), /219\.141\.136\.10/)
  assert.match(await p.textContent('#echoPresetReview'), /202\.106\.0\.20/)
  assert.equal(await p.locator('#echoPresetReview tbody tr').filter({ hasText: '新建 ICMP' }).count(), 3)
  assert.match(
    await p.locator('#echoPresetReview tbody tr').last().textContent(),
    new RegExp('复用 #' + oldIds.google),
  )
  assert.equal((await rpc('admin:getAllPingTasks')).length, before.length, 'review is read only')
  await p.click('#echoEnablePresets')
  await p.waitForFunction(() => document.getElementById('echoPresetStatus').textContent.includes('已启用'))
  const after = await rpc('admin:getAllPingTasks'),
    ids = JSON.parse((await pub()).theme_settings.echo_preset_tasks)
  assert.equal(after.length, before.length + 3)
  assert.equal(ids.google, oldIds.google)
  assert.match(await p.textContent('#echoPresetReview'), /旧任务/)
  for (const [key, id] of Object.entries(oldIds).filter(([key]) => key !== 'google'))
    assert.ok(
      (await p.textContent('#echoPresetReview')).includes('#' + id),
      'manual cleanup lists exact old ID',
    )
  for (const id of Object.values(ids)) {
    const task = after.find(t => t.id === id)
    assert.equal(task.type, 'icmp')
    assert.equal(task.default_on, true)
    assert.equal(task.interval, 60)
    assert.ok(
      nodes.every(n => task.clients.includes(n.uuid)),
      'all current nodes explicitly assigned',
    )
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, after.find(t => t.id === id).target])),
    { telecom: '124.237.177.164', unicom: '110.242.74.102', mobile: '111.63.65.247', google: '8.8.8.8' },
  )
  assert.equal((await pub()).theme_settings.qa_preserve, 'existing setting')
  for (const t of before)
    assert.deepEqual(
      after.find(n => n.id === t.id),
      t,
      'original tasks remain identical',
    )
  await p.click('#echoReviewPresets')
  await p.waitForSelector('#echoPresetReview table')
  await p.click('#echoEnablePresets')
  await p.waitForFunction(() => document.getElementById('echoEnablePresets').hidden)
  assert.equal((await rpc('admin:getAllPingTasks')).length, after.length)
  await p.reload()
  await p.waitForSelector('.echo-card')
  assert.equal(await p.locator('.echo-card').first().locator('.echo-target').count(), 4)
  const added = await (
    await context.request.post(base + '/api/admin/client/add', { data: { name: 'Future default enrolment' } })
  ).json()
  const future = added.uuid || added.data?.uuid
  assert.ok(future)
  const enrolled = await rpc('admin:getAllPingTasks')
  assert.ok(
    enrolled.filter(t => Object.values(ids).includes(t.id)).every(t => t.clients.includes(future)),
    'native default_on enrols future nodes',
  )
  await p.close()
  await context.close()
  const guest = await browser.newPage({ viewport: { width: 390, height: 844 } })
  guest.on('pageerror', e => errors.push(e.message))
  guest.on('console', m => m.type() === 'error' && errors.push(m.text()))
  const writes = []
  guest.on('request', r => {
    if (r.url().includes('/api/admin/') || r.postData()?.includes('admin:')) writes.push(r.url())
  })
  await guest.goto(base + '/')
  await guest.waitForSelector('#nodes .nc')
  await guest.click('[data-v="list"]')
  assert.equal(await guest.locator('#echoPresetAdmin').isVisible(), false)
  assert.equal(await guest.locator('.echo-card').first().locator('.echo-target').count(), 4)
  await guest.click('[data-echo-group="custom"]')
  await guest.click('[data-p="traffic"]')
  await guest.waitForSelector('.traffic-node')
  assert.match(await guest.textContent('#trafficTiles'), /累计上传/)
  assert.equal(await guest.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)), 0)
  assert.equal(writes.length, 0)
  await guest.close()
  assert.deepEqual(errors, [])
  console.log(
    'Real Komari defaults: beta.3 ID-only migration, three new Hebei tasks plus Google reuse, current/future assignment, unchanged existing tasks/settings, idempotent enable, persisted bindings, guest read-only and mobile traffic passed.',
  )
} finally {
  await browser.close()
}
