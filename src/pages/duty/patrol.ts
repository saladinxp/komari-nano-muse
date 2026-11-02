/* Nanomuse's rounds in the duty room: which desks she stops at, in what order,
   and what she notes down. Pure function of the live state, so it can be tested;
   the scene only walks her there. */
import { moodOf } from '../../cast/behavior'
import { S, thr } from '../../state'
import type { KomariNode } from '../../types/komari'
import { daysLeft } from '../../utils/format'
import { metrics } from '../../utils/metrics'

export interface Stop {
  uuid: string
  line: string
}

/** At most this many stops per round; the rest wait for the next one. */
export const MAX_STOPS = 4
/** A round every few minutes while the duty room is open; the first soon after opening. */
export const ROUND_EVERY = 4 * 60_000
export const FIRST_ROUND = 15_000

const pct = (v: number) => Math.round(v) + '%'

/** Stops for one round, most severe first: offline, CPU over the threshold, memory
    or disk over theirs, expiring within 7 days, then busy. Empty means all is well. */
export function patrolStops(nodes: KomariNode[], now = Date.now()): Stop[] {
  const found: [number, Stop][] = []
  nodes.forEach(n => {
    const mood = moodOf(n.uuid, now),
      m = metrics(n),
      dl = daysLeft(n.expired_at),
      at = (rank: number, line: string) => found.push([rank, { uuid: n.uuid, line }])
    if (!S.online.has(n.uuid) || mood === 'offline') return at(0, `${n.name} 掉线了，我记下了。`)
    if (mood === 'call' || mood === 'alert') return at(1, `${n.name} CPU ${pct(m.cpu)}，我盯着。`)
    if (m.ram >= thr('ram')) return at(2, `${n.name} 内存 ${pct(m.ram)}，我记下了。`)
    if (m.disk >= thr('disk')) return at(2, `${n.name} 磁盘 ${pct(m.disk)}，该清理了。`)
    if (dl != null && dl >= 0 && dl <= 7) return at(3, `${n.name} 还有 ${dl} 天到期，记得续费。`)
    if (mood === 'busy') at(4, `${n.name} 有点吃紧，加油。`)
  })
  return found
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_STOPS)
    .map(([, s]) => s)
}
