/* Daily routine: what a worker does from moment to moment, given the mood that
   real data decided (behavior.ts). Pure functions of time and a per-worker seed,
   shared by the duty room and the home office.

   Rules (docs/idle-behavior-update-v2.md): back to the viewer only while working
   at the desk; resting faces the viewer and may wander, visit, or step out; away
   workers are marked 暂离 and come back as soon as work arrives. */
import type { Mood } from './behavior'
import type { DeskPose } from './desk'

/** Moods that keep a worker at the desk. */
export const AT_DESK: ReadonlySet<Mood> = new Set(['work', 'busy', 'alert', 'call'])

/** Seated pose at the desk. Normal work types in bursts with a stretch now and then;
    under load it types fast and scratches its head. `now` in ms, `seed` staggers workers. */
export function deskPose(mood: Mood, now: number, seed: number): DeskPose {
  const t = now + seed * 7919
  if (mood === 'busy' || mood === 'alert' || mood === 'call') {
    if (t % 5000 < 1600) return 'busy'
    return Math.floor(t / 110) % 2 ? 'typeB' : 'typeA'
  }
  if (t % 90_000 < 3500) return 'stretch'
  if (t % 3200 >= 2400) return 'typeA'
  return Math.floor(t / 180) % 2 ? 'typeB' : 'typeA'
}

/** Where an idle worker goes next. */
export type Errand = 'coffee' | 'stroll' | 'visit' | 'toilet'

/** What they say when they set off (coffee is silent). */
export const ERRAND_LINE: Record<Errand, string> = {
  coffee: '',
  stroll: '出去转转。',
  visit: '来串个门～',
  toilet: '去趟洗手间。',
}

/** At most a quarter of a room (at least one) is away from the desks at once. */
export const awayCap = (workers: number): number => Math.max(1, Math.floor(workers / 4))

/** Pick the next errand from a roll in [0, 1). Errands that leave the desk area
    (stroll, visit, toilet) fall back to a coffee beside the desk when the room is
    at its away cap; a visit needs a neighbour. */
export function pickErrand(roll: number, o: { neighbour: boolean; away: number; cap: number }): Errand {
  if (roll < 0.35 || o.away >= o.cap) return 'coffee'
  if (roll < 0.6) return 'stroll'
  if (roll < 0.85) return o.neighbour ? 'visit' : 'stroll'
  return 'toilet'
}

/** How long an errand lasts once there, in seconds, from a roll in [0, 1). */
export function errandSeconds(e: Errand, roll: number): number {
  const [lo, hi] = { coffee: [30, 55], stroll: [14, 24], visit: [25, 40], toilet: [20, 35] }[e]
  return lo + (hi - lo) * roll
}
