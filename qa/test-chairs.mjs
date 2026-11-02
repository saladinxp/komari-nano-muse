import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { DUTY_CAST, CHAIR, chairSeat, drawChair, drawChairWorker } =
    await server.ssrLoadModule('/src/cast/chair.ts')
  const { ROOM_TYPES } = await server.ssrLoadModule('/src/pages/duty/layout.ts')
  assert.equal(Object.keys(DUTY_CAST).length, 8)
  let checks = 0
  const proportions = []
  for (const room of Object.values(ROOM_TYPES))
    for (const desk of room.desks)
      for (const sprite of Object.values(DUTY_CAST)) {
        const seat = chairSeat(sprite, desk),
          draws = []
        const ctx = {
          drawImage: (...a) => draws.push(a),
          beginPath() {},
          moveTo() {},
          lineTo() {},
          stroke() {},
        }
        drawChair(ctx, {}, seat)
        assert.equal(draws.length, 3)
        const upper = draws[0],
          cushion = draws[1],
          lower = draws[2]
        assert.ok(Math.abs(upper[6] + upper[8] - seat.hipY) < 1e-6, 'back and cushion meet the hip anchor')
        assert.ok(
          Math.abs(cushion[6] + cushion[8] - lower[6]) < 1e-6,
          'cushion and bare legs join without a gap',
        )
        for (const slice of [upper, cushion]) {
          const aspect = slice[8] / slice[4] / (slice[7] / slice[3])
          assert.ok(aspect >= 0.9 && aspect <= 1.1, 'backrest and cushion keep their aspect ratio')
        }
        const legAspect = lower[8] / lower[4] / (lower[7] / lower[3])
        assert.ok(legAspect > 0.6 && legAspect <= 1.3, 'bare-leg adjustment stays below 1.3x')
        proportions.push({
          room: room.key,
          row: desk.row,
          back: upper[8] / upper[4] / (upper[7] / upper[3]),
          cushion: cushion[8] / cushion[4] / (cushion[7] / cushion[3]),
          legs: legAspect,
        })
        assert.ok(
          Math.abs(lower[6] + lower[8] - desk.chairFloor) < 1e-6,
          'rendered chair feet meet the painted floor, not the old aisle anchor',
        )
        assert.ok(lower[8] > 15 && lower[8] < desk.size * 0.7, 'chair leg height stays plausible')
        assert.ok(seat.feetY < seat.y, 'character feet remain above the floor with footrest')
        const body = drawChairWorker(ctx, {}, sprite, 0, seat.x, seat.hipY, seat.k)
        assert.ok(
          body.y >= desk.screen.y + desk.screen.h * 0.51,
          'typing head remains below the upper readout band',
        )
        assert.ok(seat.hipY > desk.screen.y + desk.screen.h * 1.55, 'hips sit below the keyboard')
        for (const f of sprite.frames) assert.ok(f[2] > 0 && f[3] > 0 && f[2] < 800 && f[3] < 800)
        assert.match(sprite.art, /^chair-worker-/)
        checks++
      }
  const home = readFileSync('src/pages/home/scene.ts', 'utf8')
  assert.match(home, /DESK_CAST/)
  assert.doesNotMatch(home, /DUTY_CAST|drawChair/, 'home retains the original stool sprites')
  assert.match(
    readFileSync('src/pages/duty/scene.ts', 'utf8'),
    /w\.seated \? 0\.1 : -0\.1/,
    'occupied backrests follow the seated worker in depth order',
  )
  const rows = [...new Set(proportions.map(p => p.room + '/' + p.row))].map(key => {
    const group = proportions.filter(p => p.room + '/' + p.row === key)
    return {
      row: key,
      placements: group.length,
      back: [Math.min(...group.map(p => p.back)), Math.max(...group.map(p => p.back))],
      cushion: [Math.min(...group.map(p => p.cushion)), Math.max(...group.map(p => p.cushion))],
      legs: [Math.min(...group.map(p => p.legs)), Math.max(...group.map(p => p.legs))],
    }
  })
  mkdirSync('qa/shots', { recursive: true })
  writeFileSync('qa/shots/chair-proportions-r2.json', JSON.stringify(rows, null, 2))
  console.log(
    'Chairs:',
    checks,
    'character/desk placements: ground contacts, cushion joins, head clearance, footrests, depth ordering and unchanged home assets passed.',
  )
} finally {
  await server.close()
}
