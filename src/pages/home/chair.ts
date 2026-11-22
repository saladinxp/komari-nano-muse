/* The home office chair (ChatGPT art/home-comfort-v1, manifest.json): a padded
   swivel chair seen from behind, its seat facing the desk at the upper right.
   Day and night masters share one geometry. Coordinates are source pixels of the
   1254 px masters; the shipped WebP is scaled by `scale` (scripts/scene-art.py
   --home-chair). Never mirrored.

   Seated, the chair is drawn in two layers around the worker: the whole chair
   behind, then the backrest and the right armrest again in front, since seen from
   behind they sit between us and the worker. The head, shoulders and typing hands
   show above the backrest. */
import type { ChairWorker } from '../../cast/chair'
import { KEYBOARD_HAND, type Point } from './layout'

export const HOME_CHAIR = {
  art: { day: 'home-chair-day', night: 'home-chair-night' },
  scale: 0.4,
  size: 1254,
  /** Where the worker's hip rests: the cushion just in front of the backrest. */
  seat: [668, 612],
  /** Lowest caster: the chair stands on the floor here. */
  floor: 1179,
  /** Parts nearer to us than a seated worker, drawn again over them: the
      upholstered backrest, and the right armrest with its front post. */
  front: [
    [
      [157, 219],
      [188, 149],
      [212, 129],
      [314, 133],
      [533, 185],
      [627, 235],
      [677, 314],
      [690, 423],
      [690, 588],
      [666, 616],
      [470, 619],
      [282, 580],
      [235, 533],
      [169, 470],
      [157, 392],
    ],
    [
      [749, 470],
      [771, 442],
      [878, 408],
      [1016, 382],
      [1082, 392],
      [1104, 423],
      [1097, 467],
      [1063, 498],
      [1044, 505],
      [1047, 658],
      [1019, 718],
      [980, 718],
      [964, 690],
      [1003, 517],
      [940, 530],
      [859, 549],
      [784, 545],
      [756, 517],
    ],
  ],
}

/** Chair source px per worker source px: the backrest reaches the chibi's shoulders. */
export const CHAIR_PER_WORKER = 0.34

export interface ChairPlace {
  /** Hip in scene units. */
  hip: Point
  /** Scene units per chair source pixel. */
  k: number
}

/** Where the chair's floor point lands for a hip at `hip` (walking target). */
export function chairFloor(p: ChairPlace): number {
  return p.hip.y + (HOME_CHAIR.floor - HOME_CHAIR.seat[1]) * p.k
}

/** A worker (stool-free chair pose, `k` scene units per source px) typing at the
    home desk: the typing hand on the painted keyboard, the chair under the hip.
    x / y is where the chair stands on the floor, the walking target. */
export function homeDeskSeat(
  s: ChairWorker,
  k: number,
): Point & { k: number; hip: Point; chair: ChairPlace } {
  const hip = {
      x: KEYBOARD_HAND.x - (s.hand[0] - s.hip[0]) * k,
      y: KEYBOARD_HAND.y - (s.hand[1] - s.hip[1]) * k,
    },
    chair = { hip, k: k * CHAIR_PER_WORKER }
  return { x: hip.x, y: chairFloor(chair), k, hip, chair }
}

function place(ctx: CanvasRenderingContext2D, img: CanvasImageSource, p: ChairPlace) {
  const s = HOME_CHAIR.size * p.k
  ctx.drawImage(img, p.hip.x - HOME_CHAIR.seat[0] * p.k, p.hip.y - HOME_CHAIR.seat[1] * p.k, s, s)
}

/** The whole chair: an empty chair, or the layer behind a seated worker. */
export function drawHomeChair(ctx: CanvasRenderingContext2D, img: CanvasImageSource, p: ChairPlace) {
  place(ctx, img, p)
}

/** The backrest and the near armrest again, over a seated worker. */
export function drawHomeChairBack(ctx: CanvasRenderingContext2D, img: CanvasImageSource, p: ChairPlace) {
  const ox = p.hip.x - HOME_CHAIR.seat[0] * p.k,
    oy = p.hip.y - HOME_CHAIR.seat[1] * p.k
  ctx.save()
  ctx.beginPath()
  for (const part of HOME_CHAIR.front) {
    part.forEach(([x, y], i) =>
      i ? ctx.lineTo(ox + x * p.k, oy + y * p.k) : ctx.moveTo(ox + x * p.k, oy + y * p.k),
    )
    ctx.closePath()
  }
  ctx.clip()
  place(ctx, img, p)
  ctx.restore()
}
