/* Home-office floor plan, in pixels of the 1600 × 1000 home-v1 backgrounds
   (ChatGPT art/home-v1, layout-guide.json, checked against the day and night
   images). The scene shows VIEW only; scripts/scene-art.py crops the
   background to the same rectangle. */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface Point {
  x: number
  y: number
}

/** Visible part of the background: no ceiling edge, no empty floor below the cabinet. */
export const VIEW: Rect = { x: 0, y: 40, w: 1600, h: 760 }

/** Desk monitors, left to right: CPU · memory / disk · network. */
export const MONITORS: Rect[] = [
  { x: 112, y: 298, w: 151, h: 76 },
  { x: 279, y: 297, w: 163, h: 77 },
  { x: 459, y: 299, w: 144, h: 75 },
]

/** Six indicator lamps on the network panel above the desk: one per probe line. */
export const LAMPS: Point[] = [219, 274, 329, 385, 441, 496].map(x => ({ x, y: 193 }))
export const LAMP_R = 12

/** Paper area of the wall calendar. */
export const CALENDAR: Rect = { x: 1036, y: 128, w: 96, h: 137 }

/** TV screen corners (it is turned slightly toward the sofa). */
export const TV: Point[] = [
  { x: 1388, y: 204 },
  { x: 1555, y: 178 },
  { x: 1555, y: 401 },
  { x: 1388, y: 366 },
]

/** Where the plant's stem meets the soil of the empty pot on the window sill. */
export const PLANT_BASE: Point = { x: 655, y: 328 }
/** Desk phone, bottom centre, beside the mug. */
export const PHONE: Point = { x: 578, y: 410 }
/** Snack cabinet, bottom centre, on the empty floor at the right. */
export const SNACKS: Point = { x: 1478, y: 772 }

/** Front of the room (feet); the depth scale is measured from the sofa to here. */
export const DESK: Point = { x: 330, y: 716 }
/** Working at the desk: stool feet y, and the x the head is centred on (the middle
    monitor, whose readings sit in its top half so the head never covers them), and a
    size boost so the seated SD figure reads well against the big desk.
    The stool x follows from each character's head offset (cast/desk.ts). */
export const DESK_SEAT = { y: 572, headX: 360, scale: 1.05 }
/** Taking the leader's call: turned toward the viewer beside the desk, clear of the plant. */
export const CALL: Point = { x: 700, y: 650 }
/** Sofa seats (bottom of a seated character), owner first. */
export const SEATS: Point[] = [
  { x: 930, y: 462 },
  { x: 1150, y: 462 },
]
/** Nanomuse stands here on a home visit. */
export const VISIT: Point = { x: 742, y: 690 }
/** Guests and Nanomuse walk in and out past the right edge. */
export const DOOR: Point = { x: 1700, y: 690 }

/** Coffee-table top, drawn over seated characters (pre-cut by scene-art.py). */
export const TABLE: Rect = { x: 1040, y: 446, w: 308, h: 46 }

/** Standing height in scene units at the desk; the sofa is further back. */
export const STAND = 330
export const SOFA_DEPTH = 0.86
/** Height at a given floor y, for walking between the door and the sofa. */
export const depthAt = (y: number): number =>
  SOFA_DEPTH + ((y - SEATS[0].y) / (DESK.y - SEATS[0].y)) * (1 - SOFA_DEPTH)
