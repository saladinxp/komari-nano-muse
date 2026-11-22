// 2.1.1 Star Map zoom maths (map/model.ts): limits, zoom at a point, panning, edges.
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log('ok', name)
}
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`)

try {
  const M = await server.ssrLoadModule('/src/pages/map/model.ts')
  const { BASE_W, BASE_H } = M
  // An Asia-sized auto view (aspect 2.3), as fitView gives for a few Asian nodes.
  const auto = { x: 600, y: 120, w: 230, h: 100 }
  const W = 1150 // screen width: 5 px per base unit

  await test('no zoom shows the auto view; limits run from the whole world to ~8° wide', () => {
    assert.deepEqual(M.zoomedView(auto, null), auto)
    const [lo, hi] = M.zoomRange(auto)
    near(lo, Math.max(230 / BASE_W, 100 / BASE_H), 'zoomed all the way out')
    near(hi, 230 / M.ZOOM_MIN_WIDTH, 'zoomed all the way in')
    const out = M.zoomedView(auto, { z: 0.01, c: { x: 715, y: 170 } })
    assert.ok(out.w <= BASE_W + 1e-9 && out.h <= BASE_H + 1e-9, 'never larger than the world')
    assert.ok(out.x >= 0 && out.y >= 0 && out.x + out.w <= BASE_W + 1e-9 && out.y + out.h <= BASE_H + 1e-9)
    near(out.w / out.h, auto.w / auto.h, 'aspect kept, so the map keeps its height')
    near(M.zoomedView(auto, { z: 1e6, c: { x: 715, y: 170 } }).w, M.ZOOM_MIN_WIDTH, 'clamped in')
  })

  await test('zooming at a point keeps that point under the pointer', () => {
    const at = { x: 300, y: 140 }
    const before = M.zoomedView(auto, null)
    const p = { x: before.x + (at.x * before.w) / W, y: before.y + (at.y * before.w) / W }
    const z = M.zoomAt(auto, null, 2, at, W)
    near(z.z, 2, 'zoom doubled')
    const v = M.zoomedView(auto, z)
    const s = M.toScreen(p, v, W)
    near(s.x, at.x, 'x stays', 1e-6)
    near(s.y, at.y, 'y stays', 1e-6)
    // Zooming back out by the same factor at the same point returns to the auto view.
    const back = M.zoomedView(auto, M.zoomAt(auto, z, 0.5, at, W))
    for (const k of ['x', 'y', 'w', 'h']) near(back[k], auto[k], 'round trip ' + k, 1e-6)
  })

  await test('zoom steps stop at the limits and remember the clamped value', () => {
    let z = null
    for (let i = 0; i < 40; i++) z = M.zoomAt(auto, z, 1.6, { x: W / 2, y: 250 }, W)
    near(z.z, M.zoomRange(auto)[1], 'stops zooming in')
    const one = M.zoomAt(auto, z, 1 / 1.6, { x: W / 2, y: 250 }, W)
    near(one.z, M.zoomRange(auto)[1] / 1.6, 'one step out is one step, not forty')
    for (let i = 0; i < 40; i++) z = M.zoomAt(auto, z, 1 / 1.6, { x: W / 2, y: 250 }, W)
    near(z.z, M.zoomRange(auto)[0], 'stops zooming out')
  })

  await test('dragging moves the map with the pointer and stops at the world edge', () => {
    const z = M.zoomAt(auto, null, 2, { x: W / 2, y: 250 }, W)
    const v = M.zoomedView(auto, z)
    const moved = M.zoomedView(auto, M.panBy(auto, z, 100, -50, W))
    const k = v.w / W
    near(moved.x, v.x - 100 * k, 'drag right shows more to the west')
    near(moved.y, v.y + 50 * k, 'drag up shows more to the south')
    near(moved.w, v.w, 'drag keeps the zoom')
    // Fling far to the east: the view stops at the edge, and one step back moves at once.
    const edge = M.panBy(auto, z, -1e6, 0, W)
    const ev = M.zoomedView(auto, edge)
    near(ev.x + ev.w, BASE_W, 'east edge')
    const back = M.zoomedView(auto, M.panBy(auto, edge, 10, 0, W))
    near(back.x, ev.x - 10 * (ev.w / W), 'no hidden overshoot at the edge')
  })

  console.log(`map zoom: ${passed} checks passed`)
} finally {
  await server.close()
}
