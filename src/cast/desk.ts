/* Desk work art (ChatGPT art/desk-v2, manifest.json): the eight workers seated
   on a stool with their back to the viewer, plus the empty stool and Nanomuse's
   walk cycle. Back views are only for work at the desk; resting stays front-facing
   (docs/idle-behavior-update-v2.md).

   Frames are content rectangles in source PNG pixels on an equal grid; every
   frame's anchor is the stool's feet (cell centre x, `foot` px below the cell
   top). Shipped atlases are downscaled by `scale` (scripts/scene-art.py). */
import { sprite } from './draw'

type Quad = [number, number, number, number]

export type DeskPose = 'typeA' | 'typeB' | 'busy' | 'stretch'
const ORDER: DeskPose[] = ['typeA', 'typeB', 'busy', 'stretch']

export interface SheetData {
  art: string
  scale: number
  cell: number
  /** Anchor y inside a cell, source px. */
  foot: number
  frames: Quad[]
}

export interface DeskSheet extends SheetData {
  /** Seated height (stool feet → head top, typing frame) ÷ the character's standing height. */
  ratio: number
  /** Head centre x relative to the anchor, source px: used to centre the head under a screen. */
  head: number
  /** Resting typing-hand landmark, source pixels in the first cell. */
  hand: { x: number; y: number }
}

const desk = (key: string, ratio: number, head: number, frames: Quad[]): DeskSheet => ({
  art: 'desk-' + key,
  scale: 0.6,
  cell: 800,
  foot: 736,
  ratio,
  head,
  hand: { x: 400 + head + frames[0][2] * 0.4, y: frames[0][1] + frames[0][3] * 0.52 },
  frames,
})

/** Character key (roster.ts) → desk poses: typing A, typing B, busy, stretch. */
export const DESK_CAST: Record<string, DeskSheet> = {
  blue: desk('blue', 0.762, 12.5, [
    [292, 261, 278, 474],
    [1092, 261, 278, 474],
    [316, 1091, 277, 445],
    [1099, 1074, 273, 462],
  ]),
  orange: desk('orange', 0.7426, 33.5, [
    [292, 283, 283, 453],
    [1092, 283, 283, 453],
    [300, 1128, 287, 408],
    [1077, 1103, 296, 433],
  ]),
  mint: desk('mint', 0.774, 17, [
    [256, 268, 322, 468],
    [1056, 268, 322, 468],
    [250, 1093, 336, 443],
    [1059, 1072, 299, 464],
  ]),
  aoi: desk('aoi', 0.7496, 3.5, [
    [229, 241, 349, 495],
    [1029, 241, 350, 495],
    [267, 1080, 338, 456],
    [1042, 1052, 344, 484],
  ]),
  chestnut: desk('chestnut', 0.7055, 26.5, [
    [278, 272, 295, 464],
    [1078, 272, 295, 464],
    [297, 1099, 274, 437],
    [1087, 1085, 281, 450],
  ]),
  yuzu: desk('yuzu', 0.7124, 30.5, [
    [273, 276, 315, 460],
    [1073, 276, 315, 460],
    [310, 1108, 296, 427],
    [1077, 1074, 306, 462],
  ]),
  seina: desk('seina', 0.7154, 1.5, [
    [225, 263, 353, 473],
    [1025, 263, 353, 473],
    [236, 1089, 353, 447],
    [1024, 1060, 341, 476],
  ]),
  wheat: desk('wheat', 0.7343, 48.5, [
    [293, 252, 311, 484],
    [1093, 252, 311, 484],
    [315, 1087, 298, 449],
    [1105, 1047, 298, 488],
  ]),
}

/** Empty stool left at a desk while its worker is away. */
export const STOOL: SheetData = {
  art: 'desk-stool',
  scale: 0.6,
  cell: 384,
  foot: 256,
  frames: [[127, 136, 131, 120]],
}
/** Height of the stool relative to a seated typing frame (120 px stool in ~470 px frames). */
export const STOOL_SHARE = 120 / 470

/** Nanomuse walking (front view), two frames with alternating legs; same cell and anchor as her standing frame. */
export const MUSE_WALK: SheetData = {
  art: 'muse-walk',
  scale: 0.55,
  cell: 640,
  foot: 576,
  frames: [
    [113, 77, 395, 497],
    [800, 77, 395, 497],
  ],
}

/** Anchor of a frame on its grid: cell centre x, `foot` below the cell top. */
export function anchor(s: SheetData, f: Quad): { x: number; y: number } {
  return {
    x: Math.floor(f[0] / s.cell) * s.cell + s.cell / 2,
    y: Math.floor(f[1] / s.cell) * s.cell + s.foot,
  }
}

/** Draw frame `i` of a sheet with its anchor on (x, y), `k` scene units per source px.
    Returns the drawn size and the box, for hit testing. */
export function drawSheet(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource | null,
  s: SheetData,
  i: number,
  x: number,
  y: number,
  k: number,
): { x: number; y: number; w: number; h: number } {
  const f = s.frames[i],
    a = anchor(s, f)
  if (img) sprite(ctx, img, s.scale, f, a.x, a.y, x, y, k)
  return { x: x + (f[0] - a.x) * k, y: y + (f[1] - a.y) * k, w: f[2] * k, h: f[3] * k }
}

export const deskFrame = (p: DeskPose): number => ORDER.indexOf(p)

/** Scale (scene units per source px) for a seated worker whose standing height is `stand`. */
export const seatedScale = (s: DeskSheet, stand: number): number => (stand * s.ratio) / s.frames[0][3]

/** Place the hands on the painted keyboard while keeping the screen's text band clear. */
export function keyboardSeat(
  s: DeskSheet,
  stand: number,
  screen: { x: number; y: number; w: number; h: number },
) {
  const target = { x: screen.x + screen.w * 0.42, y: screen.y + screen.h * 1.55 }
  const f = s.frames[0],
    a = anchor(s, f)
  const k = Math.min(seatedScale(s, stand), (target.y - (screen.y + screen.h * 0.56)) / (s.hand.y - f[1]))
  return { x: target.x - (s.hand.x - a.x) * k, y: target.y - (s.hand.y - a.y) * k, k }
}
