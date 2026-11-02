// Only the local TCP tasks started by run-next.py; never validates CDN targets.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const [base, state] = process.argv.slice(2)
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/)
const real = JSON.parse(readFileSync(state + '/clients.json', 'utf8')).find(c => c.profile === 'real')
const tasks = JSON.parse(readFileSync(state + '/interval-tasks.json', 'utf8'))
const browser = await chromium.launch(),
  errors = [],
  results = []
try {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  p.on('pageerror', e => errors.push(e.message))
  p.on('console', m => m.type() === 'error' && errors.push(m.text()))
  await p.goto(base + '/')
  await p.waitForSelector('#nodes .nc')
  await p.click('[data-v="list"]')
  await p.click('[data-echo-group="custom"]')
  await p.waitForFunction(
    ({ uuid, ids }) => ids.every(id => NM.echo.entries[uuid]?.tasks.some(t => Number(t.id) === id)),
    { uuid: real.uuid, ids: tasks.map(t => t.id) },
  )
  for (const [width, height] of [
    [1600, 1000],
    [1920, 1080],
    [2560, 1440],
  ]) {
    await p.setViewportSize({ width, height })
    await p.waitForTimeout(180)
    for (const task of tasks) {
      const row = p
        .locator(`[data-u="${real.uuid}"] .echo-target`)
        .filter({ has: p.locator(`[data-echo-trend="${task.id}"]`) })
      const data = await row.evaluate(e => {
        const path = cls => e.querySelector(cls).getAttribute('d')
        const known = ['.echo-bars-stable', '.echo-bars-unstable', '.echo-bars-lost'].flatMap(cls =>
          [...path(cls).matchAll(/M([\d.]+)/g)].map(m => Number(m[1])),
        )
        const grey = [...path('.echo-bars-missing').matchAll(/M([\d.]+)/g)].map(m => Number(m[1]))
        const svg = e.querySelector('svg'),
          first = known.length ? Math.min(...known) : null
        return {
          cells: Number(svg.dataset.echoCells),
          known: known.length,
          greyAfterFirst: first == null ? null : grey.filter(x => x > first + 0.1).length,
        }
      })
      assert.equal(
        data.cells,
        task.interval === 300
          ? 12
          : Math.max(
              30,
              Math.min(
                60,
                Math.floor(Number((await row.locator('svg').getAttribute('viewBox')).split(' ')[2]) / 22.5) *
                  5,
              ),
            ),
      )
      assert.ok(data.known >= 2, 'at least two real observed cells for ' + task.interval)
      assert.equal(
        data.greyAfterFirst,
        0,
        'no artificial internal/rightmost grey cells ' + task.interval + 's at ' + width,
      )
      results.push({ width, interval: task.interval, ...data })
    }
  }
  const evidence = await p.evaluate(
    ({ uuid, ids }) =>
      NM.echo.entries[uuid].tasks
        .filter(t => ids.includes(t.id))
        .map(t => ({
          id: t.id,
          name: t.name,
          interval: t.interval,
          bucketSeconds: t.bucketSeconds,
          samples: t.samples.length,
          first: t.samples[0]?.t,
          last: t.samples.at(-1)?.t,
        })),
    { uuid: real.uuid, ids: tasks.map(t => t.id) },
  )
  assert.ok(evidence.every(t => t.interval === 60 || t.interval === 300))
  assert.ok(
    evidence.every(t => t.bucketSeconds > 0),
    'real metric bucket duration reaches the trend',
  )
  await p.locator(`[data-u="${real.uuid}"]`).scrollIntoViewIfNeeded()
  await p.screenshot({ path: 'qa/shots/echo-beta5-real-intervals.jpg', type: 'jpeg', quality: 80 })
  writeFileSync(
    'qa/shots/echo-beta5-real-intervals.json',
    JSON.stringify(
      {
        durationAtLeastSeconds: 660,
        scope: 'local TCP 127.0.0.1 only; no CDN reachability test',
        results,
        evidence,
      },
      null,
      2,
    ) + '\n',
  )
  assert.deepEqual(errors, [])
  console.log(
    'Real local TCP >10min: 60s/300s tasks, 1600/1920/2560, cadence/bucket metadata and no phantom internal/right-edge grey cells passed.',
  )
} finally {
  await browser.close()
}
