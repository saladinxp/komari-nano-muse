// 2.1.1 home desk on the home-comfort chair: hands on the painted keyboard, head clear of
// the backrest, chair standing on the floor in front of the desk, for all eight characters.
import assert from 'node:assert/strict'
import { createServer } from 'vite'

/* facts.ts reaches the shared state module, which touches these at load. */
const mem = new Map()
globalThis.window = globalThis
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log('ok', name)
}

try {
  const H = await server.ssrLoadModule('/src/pages/home/chair.ts')
  const L = await server.ssrLoadModule('/src/pages/home/layout.ts')
  const C = await server.ssrLoadModule('/src/cast/chair.ts')
  const D = await server.ssrLoadModule('/src/cast/desk.ts')
  const keys = Object.keys(C.DUTY_CAST)
  const seatOf = key =>
    H.homeDeskSeat(
      C.DUTY_CAST[key],
      D.seatedScale(D.DESK_CAST[key], L.STAND * L.depthAt(L.DESK_SEAT.y) * L.DESK_SEAT.scale),
    )
  const KEYS = { x0: 262, x1: 412, y0: 393, y1: 405 } // painted keyboard, scene units
  const report = []

  await test('the typing hand rests on the painted keyboard', () => {
    assert.equal(keys.length, 8)
    for (const key of keys) {
      const s = C.DUTY_CAST[key],
        seat = seatOf(key),
        hand = {
          x: seat.hip.x + (s.hand[0] - s.hip[0]) * seat.k,
          y: seat.hip.y + (s.hand[1] - s.hip[1]) * seat.k,
        }
      assert.ok(hand.x >= KEYS.x0 && hand.x <= KEYS.x1, `${key} hand x ${hand.x}`)
      assert.ok(hand.y >= KEYS.y0 && hand.y <= KEYS.y1, `${key} hand y ${hand.y}`)
    }
  })

  await test('head and shoulders show above the backrest in every desk pose', () => {
    for (const key of keys) {
      const s = C.DUTY_CAST[key],
        seat = seatOf(key),
        backTop =
          seat.hip.y -
          (H.HOME_CHAIR.seat[1] - Math.min(...H.HOME_CHAIR.front[0].map(p => p[1]))) * seat.chair.k
      for (let i = 0; i < 4; i++) {
        const box = C.drawChairWorker(null, null, s, i, seat.hip.x, seat.hip.y, seat.k)
        assert.ok(
          backTop - box.y > box.h * 0.3,
          `${key} pose ${i}: ${Math.round(backTop - box.y)} of ${Math.round(box.h)} above the back`,
        )
        assert.ok(box.y >= 250, `${key} pose ${i}: head stays on the monitors, top ${Math.round(box.y)}`)
        if (i === 0) report.push(`${key} head ${Math.round(box.y)}`)
      }
    }
  })

  await test('the chair stands on the floor in front of the desk, inside the view', () => {
    for (const key of keys) {
      const seat = seatOf(key),
        k = seat.chair.k,
        left = seat.hip.x - H.HOME_CHAIR.seat[0] * k,
        right = left + H.HOME_CHAIR.size * k
      assert.ok(seat.y > 547 && seat.y < L.VIEW.y + L.VIEW.h - 40, `${key} chair floor ${seat.y}`)
      assert.ok(left >= L.VIEW.x && right <= L.DESK.x + 300, `${key} chair x ${left}–${right}`)
      assert.ok(H.chairFloor(seat.chair) === seat.y)
    }
  })

  await test('front layer outlines lie inside the chair canvas', () => {
    for (const part of H.HOME_CHAIR.front)
      for (const [x, y] of part)
        assert.ok(x >= 0 && y >= 0 && x <= H.HOME_CHAIR.size && y <= H.HOME_CHAIR.size)
    const [sx, sy] = H.HOME_CHAIR.seat
    assert.ok(sy < H.HOME_CHAIR.floor && sx > 0)
  })

  await test('the room is at night with the dark scheme, else by the visitor clock', async () => {
    const F = await server.ssrLoadModule('/src/pages/home/facts.ts')
    const noon = new Date(2026, 10, 2, 12),
      late = new Date(2026, 10, 2, 22)
    assert.equal(F.roomNight(true, noon), true, 'dark scheme at noon: night')
    assert.equal(F.roomNight(false, noon), false, 'light scheme at noon: day')
    assert.equal(F.roomNight(false, late), true, 'light scheme at 22:00: night')
    assert.equal(F.darkScheme(), false, 'no document: not dark')
  })

  console.log(report.join(' · '))
  console.log(`home chair: ${passed} checks passed`)
} finally {
  await server.close()
}
