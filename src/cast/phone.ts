/* The desk phone (ChatGPT art/home-v1, home-phone atlas): quiet and ringing frames.
   Shared by the home office (on the desk, rings for leader calls) and the duty
   room (appears on a worker's desk while the leader is calling). */
import { art } from './art'
import { sprite } from './draw'

type Quad = [number, number, number, number]

/** Same shape as the home atlases (pages/home/atlas.ts): source-pixel frames on a square grid. */
export const DESK_PHONE = {
  art: 'home-phone',
  scale: 0.2,
  cell: 960,
  frames: [
    [119, 391, 722, 505],
    [1056, 323, 768, 573],
  ] as Quad[],
}

/** Draw the phone with its bottom centre at (x, y), `w` scene units wide; returns false until the art is loaded. */
export function drawDeskPhone(
  ctx: CanvasRenderingContext2D,
  ringing: boolean,
  x: number,
  y: number,
  w: number,
): boolean {
  const sheet = art(DESK_PHONE.art)
  if (!sheet.ready) return false
  const f = DESK_PHONE.frames[ringing ? 1 : 0],
    k = w / f[2],
    ax = Math.floor(f[0] / DESK_PHONE.cell) * DESK_PHONE.cell + DESK_PHONE.cell / 2
  sprite(ctx, sheet.img, DESK_PHONE.scale, f, ax, f[1] + f[3], x, y, k)
  return true
}
