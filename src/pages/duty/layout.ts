/* Duty-room floor plan.

   Room types, desk positions and monitor rectangles come from the 摸鱼机房
   room-layout data (vendor/server-breakroom/dist/room-layout.mjs). Coordinates
   are authored against each background's source pixels and scaled into the
   scene size here, so a redrawn background only needs new numbers below.

   Rules carried over from the breakroom:
   - capacity follows configured nodes (offline included), never the online count;
   - a desk without a node stays empty: no worker, dark screen;
   - one room holds at most 16 desks; larger groups are split into pages. */
import type { KomariNode } from '../../types/komari'

export type RoomSize = 'small' | 'medium' | 'large'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** One workstation. (x, y) is where the worker's feet stand; size is the worker's height. */
export interface Desk {
  x: number
  y: number
  size: number
  row: number
  screen: Rect
  /** Painted front-leg floor plane for a chair, separate from the standing/errand anchor. */
  chairFloor?: number
}

export interface RoomType {
  key: RoomSize
  name: string
  capacity: number
  /** Scene size in scene units; the canvas scales it to fit. */
  w: number
  h: number
  /** Artwork keys, see assets.ts. */
  day: string
  night: string
  /** Optional furniture layer drawn over the background (the large room's fourth desk row). */
  front?: { art: string; dest: Rect }
  desks: Desk[]
}

/** A room on the floor: one group (or one page of a big group) and the room type that fits it. */
export interface Room {
  id: string
  title: string
  /** Page label when a group spans several rooms, e.g. "2/3". */
  part: string
  nodes: KomariNode[]
  type: RoomType
}

export const MAX_DESKS = 16

type Quad = [number, number, number, number]
const rect = ([x, y, w, h]: Quad, sx: number, sy: number): Rect => ({
  x: x * sx,
  y: y * sy,
  w: w * sx,
  h: h * sy,
})

function desks(
  xs: number[][],
  ys: number[],
  sizes: number[],
  screens: Quad[][],
  sx: number,
  sy: number,
): Desk[] {
  return xs.flatMap((row, r) =>
    row.map((x, c) => ({
      x: x * sx,
      y: ys[r] * sy,
      size: sizes[r],
      row: r,
      screen: rect(screens[r][c], sx, sy),
    })),
  )
}

/* Small room: 3 desks in one row. Background 1620 × 972 → scene 1100 × 660. */
const SMALL = desks(
  [[450, 820, 1190]],
  [658],
  [196],
  [
    [
      [394, 314, 135, 72],
      [760, 314, 137, 72],
      [1123, 314, 137, 72],
    ],
  ],
  1100 / 1620,
  660 / 972,
)

/* Medium room: 2 rows of 4. Background 1586 × 992 → scene 1600 × 1000. */
const MEDIUM = desks(
  [
    [368, 654, 936, 1215],
    [331, 657, 949, 1260],
  ],
  [525, 780],
  [190, 210],
  [
    [
      [310, 292, 116, 54],
      [595, 293, 117, 53],
      [878, 293, 116, 54],
      [1161, 293, 108, 54],
    ],
    [
      [264, 496, 136, 64],
      [589, 496, 135, 64],
      [881, 496, 135, 64],
      [1192, 496, 136, 64],
    ],
  ],
  1600 / 1586,
  1000 / 992,
)

/* Large room: 3 rows of 4 on the background (1402 × 1122 → scene 1600 × 1280)
   plus a fourth row on the transparent furniture strip. */
const LARGE = desks(
  [
    [345, 596, 818, 1057],
    [308, 580, 837, 1099],
    [242, 560, 856, 1157],
  ],
  [434, 607, 839],
  [158, 170, 184],
  [
    [
      [296, 264, 98, 44],
      [549, 264, 97, 44],
      [768, 264, 100, 44],
      [1008, 264, 99, 44],
    ],
    [
      [253, 419, 109, 51],
      [527, 418, 108, 51],
      [783, 419, 109, 51],
      [1045, 418, 108, 51],
    ],
    [
      [178, 614, 129, 60],
      [499, 613, 125, 60],
      [793, 614, 126, 60],
      [1094, 614, 124, 60],
    ],
  ],
  1600 / 1402,
  1280 / 1122,
)

/* Furniture strip: source rectangle [28, 188, 2118, 363] of foreground-desks-v3,
   drawn at STRIP. scripts/scene-art.py pre-crops the image to that rectangle. */
const STRIP: Rect = { x: 65, y: 978, w: 1470, h: 252 }
const STRIP_SRC = { x: 28, y: 188, w: 2118 }
const stripScale = STRIP.w / STRIP_SRC.w
const FRONT_SCREENS: Quad[] = [
  [174, 193, 232, 110],
  [717, 193, 228, 109],
  [1237, 193, 229, 110],
  [1788, 193, 215, 109],
]
FRONT_SCREENS.forEach(([x, y, w, h]) => {
  const screen = {
    x: STRIP.x + (x - STRIP_SRC.x) * stripScale,
    y: STRIP.y + (y - STRIP_SRC.y) * stripScale,
    w: w * stripScale,
    h: h * stripScale,
  }
  LARGE.push({ x: screen.x + screen.w / 2, y: 1244, size: 196, row: 3, screen })
})

/* Calibrated against the existing background's desk-leg contacts. The old
   standing y values are in the aisle, especially in small/medium rooms; using
   those as chair feet produces excessively long legs. Values also follow
   Claude's corrected front-leg measurements (09301ef). No background repaint. */
SMALL.forEach(d => (d.chairFloor = 378))
MEDIUM.forEach(d => (d.chairFloor = [478, 715][d.row]))
LARGE.forEach(d => (d.chairFloor = [469, 670, 933, 1222][d.row]))

export const ROOM_TYPES: Record<RoomSize, RoomType> = {
  small: {
    key: 'small',
    name: '小值班室',
    capacity: 3,
    w: 1100,
    h: 660,
    day: 'room-small-day',
    night: 'room-small-night',
    desks: SMALL,
  },
  medium: {
    key: 'medium',
    name: '中值班室',
    capacity: 8,
    w: 1600,
    h: 1000,
    day: 'room-medium-day',
    night: 'room-medium-night',
    desks: MEDIUM,
  },
  large: {
    key: 'large',
    name: '大值班室',
    capacity: 16,
    w: 1600,
    h: 1280,
    day: 'room-large-day',
    night: 'room-large-night',
    front: { art: 'room-large-front', dest: STRIP },
    desks: LARGE,
  },
}

/** Smallest room type that seats `count` nodes (0–16). */
export function roomTypeFor(count: number): RoomType {
  if (!Number.isInteger(count) || count < 0 || count > MAX_DESKS) throw new RangeError('room count ' + count)
  return Object.values(ROOM_TYPES).find(t => t.capacity >= count)
}

const chunk = <T>(xs: T[], n: number): T[][] =>
  xs.length ? Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n)) : [[]]

/** Split the visible nodes into rooms: one per Komari group, 16 desks per page.
    With several groups and at most 16 nodes, a whole-floor room comes first. */
export function buildRooms(nodes: KomariNode[]): Room[] {
  const groups = new Map<string, KomariNode[]>()
  nodes.forEach(n => {
    const g = (n.group || '').trim()
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g).push(n)
  })
  const rooms: Room[] = []
  const add = (id: string, title: string, list: KomariNode[]) =>
    chunk(list, MAX_DESKS).forEach((part, i, all) =>
      rooms.push({
        id: all.length > 1 ? id + '#' + (i + 1) : id,
        title,
        part: all.length > 1 ? i + 1 + '/' + all.length : '',
        nodes: part,
        type: roomTypeFor(part.length),
      }),
    )
  if (groups.size <= 1) add('all', [...groups.keys()][0] || '值班室', nodes)
  else {
    if (nodes.length <= MAX_DESKS) add('all', '全员', nodes)
    groups.forEach((list, g) => add('g:' + g, g || '未分组', list))
  }
  return rooms
}
