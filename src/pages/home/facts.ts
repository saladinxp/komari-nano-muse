/* What each object in the home shows, derived from real node data only.
   Pure functions: the scene draws them, the legend under it spells them out. */
import type { KomariNode } from '../../types/komari'
import { daysLeft, fDate, validDate } from '../../utils/format'
import { trafficUsed } from '../../utils/metrics'
import type { HomePose } from './atlas'

const DAY = 86400

/** Plant grows with uptime and starts over after a reboot. */
export const PLANT_LABEL = ['发芽', '小苗', '长大', '开花']
export function plantStage(uptimeSec: number): number {
  const d = uptimeSec / DAY
  return d < 7 ? 0 : d < 30 ? 1 : d < 100 ? 2 : 3
}

/** Snack cabinet = traffic quota left: full, half, few, empty. Unlimited stays full. */
export const SNACK_LABEL = ['满', '半', '少', '空']
export function snackLevel(
  n: KomariNode,
  m: { tu: number; td: number },
): { frame: number; used: number | null } {
  if (!(n.traffic_limit > 0)) return { frame: 0, used: null }
  const used = (trafficUsed(n, m) / n.traffic_limit) * 100
  return { frame: used < 40 ? 0 : used < 70 ? 1 : used < 90 ? 2 : 3, used }
}

/** Wall calendar: the expiry date, circled in red within 7 days. */
export interface Expiry {
  date: Date | null
  days: number | null
  urgent: boolean
  label: string
}
export function expiry(n: KomariNode): Expiry {
  const date = validDate(n.expired_at),
    days = daysLeft(n.expired_at)
  if (!date || days == null) return { date: null, days: null, urgent: false, label: '长期' }
  return {
    date,
    days,
    urgent: days <= 7,
    label: days < 0 ? `${fDate(date)} · 已过期 ${-days} 天` : `${fDate(date)} · 剩 ${days} 天`,
  }
}

/** Window and lamps follow the visitor's local clock. */
export const isNight = (d = new Date()): boolean => d.getHours() < 6 || d.getHours() >= 19

/** What an idle worker does: sofa time (snacks, games, TV) and now and then a trip
    out of the room (washroom, a walk). With a guest they stay and play together.
    Each slot lasts 40 s. */
export type Activity = Exclude<HomePose, 'phone'> | 'out'
const ROUTINE: Activity[] = ['snack', 'game', 'tv', 'snack', 'out', 'game', 'tv']
export function activity(now: number, seed: number, guest: boolean): Activity {
  if (guest) return 'game'
  return ROUTINE[Math.floor(now / 40_000 + seed) % ROUTINE.length]
}

/** One network-panel lamp per probe line. */
export interface Lamp {
  name: string
  /** Latest latency in ms; null when the last sample timed out or is missing. */
  lat: number | null
  /** Loss over the last hour, percent. */
  loss: number | null
  timeout: boolean
}
export type LampTone = 'off' | 'ok' | 'warn' | 'bad'
export function lampTone(l: Lamp | null): LampTone {
  if (!l) return 'off'
  if (l.timeout || (l.loss != null && l.loss >= 5) || l.lat == null) return 'bad'
  return l.lat < 100 ? 'ok' : l.lat < 200 ? 'warn' : 'bad'
}
