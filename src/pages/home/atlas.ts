/* Home-office atlases (ChatGPT art/home-v1, manifest.json).

   Every atlas is an equal grid; each frame's content rectangle is given in
   source PNG pixels, and its anchor is the cell's bottom centre (the content
   bottom sits on it). Shipped files are downscaled by `scale`
   (scripts/scene-art.py, keep in sync). */

type Quad = [number, number, number, number]

export interface HomeAtlas {
  art: string
  scale: number
  /** Cell size in source pixels. */
  cell: number
  frames: Quad[]
}

export type HomePose = 'phone' | 'snack' | 'game' | 'tv'
export const HOME_POSES: HomePose[] = ['phone', 'snack', 'game', 'tv']

const chars = (art: string, frames: Quad[]): HomeAtlas => ({ art, scale: 0.55, cell: 800, frames })

/** Character key (roster.ts) → home poses, in HOME_POSES order. */
export const HOME_CAST: Record<string, HomeAtlas> = {
  blue: chars('home-blue', [
    [211, 109, 377, 627],
    [1015, 209, 369, 527],
    [205, 1009, 389, 527],
    [1004, 995, 392, 541],
  ]),
  orange: chars('home-orange', [
    [228, 122, 344, 614],
    [1033, 207, 333, 529],
    [205, 993, 389, 543],
    [997, 1007, 406, 529],
  ]),
  mint: chars('home-mint', [
    [179, 128, 442, 608],
    [963, 225, 473, 511],
    [168, 1030, 464, 506],
    [959, 1021, 481, 515],
  ]),
  aoi: chars('home-aoi', [
    [189, 72, 422, 664],
    [972, 162, 455, 574],
    [173, 988, 453, 548],
    [962, 1000, 475, 536],
  ]),
  chestnut: chars('home-chestnut', [
    [201, 75, 398, 661],
    [1003, 152, 394, 584],
    [187, 972, 425, 564],
    [1001, 1008, 397, 528],
  ]),
  yuzu: chars('home-yuzu', [
    [196, 87, 407, 649],
    [992, 175, 416, 561],
    [184, 986, 432, 550],
    [987, 996, 425, 540],
  ]),
  seina: chars('home-seina', [
    [159, 72, 482, 664],
    [946, 171, 507, 565],
    [143, 981, 514, 555],
    [944, 979, 511, 557],
  ]),
  wheat: chars('home-wheat', [
    [212, 72, 376, 664],
    [1007, 178, 386, 558],
    [191, 1000, 417, 536],
    [997, 1019, 406, 517],
  ]),
}

/** Plant without pot: sprout, seedling, grown, in bloom (stem bases aligned). */
export const PLANT: HomeAtlas = {
  art: 'home-plant',
  scale: 0.3,
  cell: 800,
  frames: [
    [270, 540, 260, 196],
    [994, 347, 412, 389],
    [109, 1043, 582, 493],
    [913, 1041, 573, 495],
  ],
}

/** Snack cabinet: full, half, few, empty. */
export const SNACK_CABINET: HomeAtlas = {
  art: 'home-snacks',
  scale: 0.5,
  cell: 800,
  frames: [
    [150, 203, 499, 533],
    [950, 203, 500, 533],
    [150, 1002, 499, 534],
    [950, 1002, 499, 534],
  ],
}

/** Desk phone: quiet, ringing. Shared with the duty room, so it lives in cast/phone.ts. */
export { DESK_PHONE } from '../../cast/phone'

/** Anchor of a frame: bottom centre of its grid cell, in source pixels. */
export function anchorOf(a: HomeAtlas, f: Quad): { x: number; y: number } {
  return { x: Math.floor(f[0] / a.cell) * a.cell + a.cell / 2, y: f[1] + f[3] }
}
