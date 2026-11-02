/* Nanomuse in SD form (ChatGPT home-v1 nanomuse-chibi + desk-v2 walk frames),
   shared by the home visit and the duty-room rounds. */
import { art } from './art'
import { drawSheet, MUSE_WALK, type SheetData } from './desk'

export type MusePose = 'stand' | 'walk' | 'tablet' | 'phone' | 'wave'

/** Standing poses: stand, (old walk A/B, unused), tablet, phone, wave. Anchor = feet. */
const MUSE: SheetData = {
  art: 'home-nanomuse',
  scale: 0.55,
  cell: 640,
  foot: 576,
  frames: [
    [131, 76, 377, 500],
    [775, 80, 369, 496],
    [1409, 80, 382, 496],
    [131, 715, 377, 501],
    [782, 718, 356, 498],
    [1410, 718, 379, 498],
  ],
}
const FRAME: Record<Exclude<MusePose, 'walk'>, number> = { stand: 0, tablet: 3, phone: 4, wave: 5 }

/** Draw her with her feet on (x, y), `height` scene units tall, with a soft cyan glow.
    Walking alternates the two leg frames (still frame when motion is reduced). */
export function drawMuse(
  ctx: CanvasRenderingContext2D,
  pose: MusePose,
  x: number,
  y: number,
  height: number,
  t: number,
  reduced: boolean,
): { x: number; y: number; w: number; h: number } {
  const k = height / MUSE.frames[0][3],
    walk = art(MUSE_WALK.art),
    still = art(MUSE.art)
  ctx.save()
  ctx.shadowColor = 'rgba(104, 224, 230, .55)'
  ctx.shadowBlur = 24
  const box =
    pose === 'walk' && !reduced
      ? drawSheet(ctx, walk.ready ? walk.img : null, MUSE_WALK, Math.floor(t * 4.5) % 2, x, y, k)
      : drawSheet(ctx, still.ready ? still.img : null, MUSE, FRAME[pose === 'walk' ? 'stand' : pose], x, y, k)
  ctx.restore()
  return box
}
