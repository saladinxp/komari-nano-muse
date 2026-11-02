// Visual QA: all eight characters in medium/large rooms and three in a small room.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const { chromium } = createRequire(import.meta.url)('playwright')
mkdirSync('qa/shots', { recursive: true })
const browser = await chromium.launch(),
  errors = []
try {
  for (const [name, count] of [
    ['small', 3],
    ['medium', 8],
    ['large', 16],
  ]) {
    const p = await browser.newPage({ viewport: { width: 1800, height: 1600 } })
    p.on('pageerror', e => errors.push(e.message))
    await p.addInitScript(
      ({ count }) => {
        Math.random = () => 0.7
        localStorage.setItem(
          'nm-duty-cast',
          JSON.stringify(
            Object.fromEntries(
              Array.from({ length: 16 }, (_, i) => [
                'demo-' + i,
                ['orange', 'blue', 'mint', 'aoi', 'chestnut', 'yuzu', 'seina', 'wheat'][i === 12 ? 0 : i % 8],
              ]),
            ),
          ),
        )
        localStorage.setItem('nm-duty-room', 'all')
      },
      { count },
    )
    await p.goto('file://' + resolve('preview/NanoMuse-preview.html') + '#/')
    await p.waitForFunction(() => window.NM?.lastSync)
    await p.evaluate(async count => {
      // Freeze only the local fixture's live updates, then feed working samples through the actual socket handler.
      window.previewSocket.send = () => {}
      const data = {}
      for (const n of window.NM.nodes.slice(0, count))
        data[n.uuid] = {
          cpu: { usage: 30 },
          ram: { used: 100, total: n.mem_total },
          disk: { used: 100, total: n.disk_total },
          network: { up: 100, down: 100, totalUp: 0, totalDown: 0 },
          uptime: 10000,
        }
      window.NM.nodes = window.NM.nodes.slice(0, count).map(n => ({ ...n, group: '工位复核' }))
      window.previewSocket.onmessage({ data: JSON.stringify({ data: { online: Object.keys(data), data } }) })
      location.hash = '#/duty'
    }, count)
    await p.waitForFunction(count => document.querySelectorAll('#dutyRoster li').length === count, count)
    await p.waitForTimeout(2200)
    const geometry = await p.evaluate(() => window.__NM_APP__.dutySeatsForQA())
    assert.ok(
      geometry.every(g => g.seated && Math.abs(g.seat.y - g.floor) < 0.01),
      'all occupied chairs use the painted floor',
    )
    assert.ok(
      geometry.every(g => g.art.startsWith('chair-worker-')),
      'all workers use stool-free art',
    )
    writeFileSync(`qa/shots/chair-geometry-${name}.json`, JSON.stringify(geometry, null, 2))
    await p
      .locator('#dutyCanvas')
      .screenshot({ path: `qa/shots/seats-${name}.jpg`, type: 'jpeg', quality: 85 })
    if (name === 'large') {
      const box = await p.locator('#dutyCanvas').boundingBox()
      const sx = box.width / 1600,
        sy = box.height / 1280
      await p.screenshot({
        path: 'qa/shots/seat-orange-fixed.jpg',
        type: 'jpeg',
        quality: 88,
        clip: { x: box.x + 95 * sx, y: box.y + 940 * sy, width: 415 * sx, height: 340 * sy },
      })
      await p.evaluate(() => {
        const data = structuredClone(window.NM.live)
        data['demo-0'].cpu = 2
        window.previewSocket.onmessage({
          data: JSON.stringify({ data: { online: Object.keys(data), data } }),
        })
        const now = Date.now(),
          minute = Math.floor(now / 60000) * 60000
        window.__NM_APP__.seedTrack(
          'demo-0',
          Array.from({ length: 22 }, (_, i) => [minute - (21 - i) * 60000, 2]),
          now,
        )
        window.previewSocket.onmessage({
          data: JSON.stringify({ data: { online: Object.keys(data), data } }),
        })
      })
      await p.waitForFunction(
        () => window.__NM_APP__.dutySeatsForQA().find(g => g.uuid === 'demo-0')?.where !== 'desk',
      )
      await p.waitForTimeout(3000)
      await p
        .locator('#dutyCanvas')
        .screenshot({ path: 'qa/shots/chairs-away.jpg', type: 'jpeg', quality: 83 })
      await p.evaluate(() => {
        const data = structuredClone(window.NM.live)
        data['demo-0'].cpu = 30
        window.previewSocket.onmessage({
          data: JSON.stringify({ data: { online: Object.keys(data), data } }),
        })
      })
      await p.waitForFunction(() => window.__NM_APP__.dutySeatsForQA().find(g => g.uuid === 'demo-0')?.seated)
      await p.evaluate(() => {
        window.previewSocket.onmessage({
          data: JSON.stringify({ data: { online: [], data: window.NM.live } }),
        })
      })
      await p.waitForFunction(() =>
        [...document.querySelectorAll('#dutyRoster .dr-mood')].every(e => e.textContent.includes('离线')),
      )
      await p
        .locator('#dutyCanvas')
        .screenshot({ path: 'qa/shots/chairs-offline.jpg', type: 'jpeg', quality: 83 })
    }
    if (name === 'large') {
      await p.evaluate(() => {
        const data = structuredClone(window.NM.live)
        Object.values(data).forEach(r => (r.cpu = 30))
        window.previewSocket.onmessage({
          data: JSON.stringify({ data: { online: Object.keys(data), data } }),
        })
      })
      await p.waitForFunction(() => window.__NM_APP__.dutySeatsForQA().every(g => g.seated))
    }
    // Pause only this QA capture so the next animation frame cannot erase the guides.
    await p.evaluate(() => (window.requestAnimationFrame = () => 0))
    await p.waitForTimeout(100)
    await p.evaluate(
      ({ geometry, width }) => {
        const cv = document.getElementById('dutyCanvas'),
          ctx = cv.getContext('2d')
        ctx.save()
        ctx.setTransform(cv.width / width, 0, 0, cv.width / width, 0, 0)
        for (const g of geometry) {
          const half = g.seat.width * 0.7
          ctx.strokeStyle = '#20c873'
          ctx.lineWidth = 3
          ctx.setLineDash([6, 4])
          ctx.beginPath()
          ctx.moveTo(g.seat.x - half, g.floor)
          ctx.lineTo(g.seat.x + half, g.floor)
          ctx.stroke()
          ctx.strokeStyle = '#ed445f'
          ctx.setLineDash([])
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(g.seat.x - 8, g.seat.y - 9)
          ctx.lineTo(g.seat.x, g.seat.y)
          ctx.lineTo(g.seat.x + 8, g.seat.y - 9)
          ctx.stroke()
        }
        ctx.restore()
      },
      { geometry, width: name === 'small' ? 1100 : 1600 },
    )
    await p
      .locator('#dutyCanvas')
      .screenshot({ path: `qa/shots/chairs-floor-${name}.jpg`, type: 'jpeg', quality: 84 })
    await p.close()
  }
  assert.deepEqual(errors, [])
  console.log(
    'Chairs: all eight characters, three rooms, ground guides, empty/away, return and offline layers passed.',
  )
} finally {
  await browser.close()
}
