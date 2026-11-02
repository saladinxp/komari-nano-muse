/* Duty-room chairs and stool-free workers. The home office keeps its original
   DESK_CAST: these masters are separate and never change the home's appearance. */
import { CHAIR_DATA, WORKER_DATA } from './chair-data'
import type { Desk } from '../pages/duty/layout'

export interface ChairWorker {
  art: string
  scale: number
  cell: number
  hip: number[]
  hand: number[]
  frames: number[][]
}
export const DUTY_CAST: Record<string, ChairWorker> = WORKER_DATA
export const CHAIR = CHAIR_DATA

/** Higher reaching arms lower the hips. Walking coordinates remain on the floor,
    independent of the hip anchor used only for drawing a seated sprite. */
export function chairSeat(s: ChairWorker, desk: Desk) {
  const r = desk.screen,
    f = s.frames[0]
  const hand = { x: r.x + r.w * 0.42, y: r.y + r.h * 1.55 }
  const k = Math.min((desk.size * 0.82) / f[3], (hand.y - (r.y + r.h * 0.52)) / (s.hand[1] - f[1]))
  const x = hand.x - (s.hand[0] - s.hip[0]) * k
  const hipY = hand.y - (s.hand[1] - s.hip[1]) * k
  const backHeight = (s.hip[1] - f[1]) * k * 0.44
  const chairScale = backHeight / (CHAIR.split - CHAIR.frame[1])
  const width = CHAIR.frame[2] * chairScale
  const cushionHeight = (CHAIR.legSplit - CHAIR.split) * chairScale
  return {
    x,
    y: desk.chairFloor ?? desk.y,
    k,
    hipY,
    width,
    backHeight,
    cushionHeight,
    hand,
    feetY: hipY + (f[1] + f[3] - s.hip[1]) * k,
  }
}
export type ChairSeat = ReturnType<typeof chairSeat>

/** Backrest and cushion keep the master's aspect ratio. Only the bare legs
    adjust to the painted floor. Occupied and empty chairs share this geometry. */
export function drawChair(ctx: CanvasRenderingContext2D, img: CanvasImageSource, seat: ChairSeat) {
  const [sx, sy, sw, sh] = CHAIR.frame,
    split = CHAIR.split,
    legSplit = CHAIR.legSplit
  const scale = CHAIR.scale,
    kx = seat.width / sw
  const left = seat.x - (CHAIR.seat[0] - sx) * kx
  ctx.drawImage(
    img,
    sx * scale,
    sy * scale,
    sw * scale,
    (split - sy) * scale,
    left,
    seat.hipY - seat.backHeight,
    seat.width,
    seat.backHeight,
  )
  ctx.drawImage(
    img,
    sx * scale,
    split * scale,
    sw * scale,
    (legSplit - split) * scale,
    left,
    seat.hipY,
    seat.width,
    seat.cushionHeight,
  )
  ctx.drawImage(
    img,
    sx * scale,
    legSplit * scale,
    sw * scale,
    (sy + sh - legSplit) * scale,
    left,
    seat.hipY + seat.cushionHeight,
    seat.width,
    seat.y - seat.hipY - seat.cushionHeight,
  )
  // A footrest on the tall desk chair supports the chibi worker's feet.
  const y = Math.min(seat.y - 12, seat.feetY + 2)
  ctx.strokeStyle = '#a87743'
  ctx.lineWidth = Math.max(2, seat.width * 0.035)
  ctx.beginPath()
  ctx.moveTo(left + seat.width * 0.12, y)
  ctx.lineTo(left + seat.width * 0.82, y)
  ctx.stroke()
}

export function drawChairWorker(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource | null,
  s: ChairWorker,
  index: number,
  x: number,
  hipY: number,
  k: number,
) {
  const f = s.frames[index],
    a = { x: Math.floor(f[0] / s.cell) * s.cell + s.hip[0], y: Math.floor(f[1] / s.cell) * s.cell + s.hip[1] }
  const box = { x: x + (f[0] - a.x) * k, y: hipY + (f[1] - a.y) * k, w: f[2] * k, h: f[3] * k }
  if (img)
    ctx.drawImage(
      img,
      f[0] * s.scale,
      f[1] * s.scale,
      f[2] * s.scale,
      f[3] * s.scale,
      box.x,
      box.y,
      box.w,
      box.h,
    )
  return box
}
