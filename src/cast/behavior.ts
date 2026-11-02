/* Node state → how its worker behaves. Shared by the duty room now and the
   home-office detail page later.

   Every live tick updates a small per-node track: CPU averaged into one-minute
   buckets (the monitor curve), and how long the node has been idle or above the
   alert threshold. Moods are decided from real data only. */
import { thr } from '../state'

export type Mood = 'offline' | 'call' | 'alert' | 'busy' | 'work' | 'idle'

export const MOOD_LABEL: Record<Mood, string> = {
  offline: '离线休眠',
  call: '领导来电',
  alert: '忙到冒汗',
  busy: '有点吃紧',
  work: '认真工作',
  idle: '带薪摸鱼',
}

/** CPU below this percentage counts as idle. */
export const IDLE_CPU = 5
/** Idle this long before the worker leaves the desk. */
export const IDLE_AFTER = 10 * 60_000
/** Above the alert threshold this long before the leader phones. */
export const CALL_AFTER = 60_000
const MINUTE = 60_000
const HISTORY = 60

export interface Track {
  /** One-minute CPU buckets, oldest first: [bucket start ms, mean %]. */
  history: [number, number][]
  /** Running sum for the current bucket. */
  bucket: { at: number; sum: number; n: number } | null
  cpu: number
  online: boolean | null
  uptime: number
  idleSince: number | null
  alertSince: number | null
}

const tracks = new Map<string, Track>()

export function trackOf(uuid: string): Track {
  let t = tracks.get(uuid)
  if (!t) {
    t = { history: [], bucket: null, cpu: 0, online: null, uptime: 0, idleSince: null, alertSince: null }
    tracks.set(uuid, t)
  }
  return t
}

/** Fold one live sample into the track. */
export function sample(uuid: string, online: boolean, cpu: number, uptime: number, now = Date.now()): void {
  const t = trackOf(uuid)
  t.online = online
  if (!online) {
    t.idleSince = t.alertSince = null
    t.bucket = null
    return
  }
  t.cpu = cpu
  t.uptime = uptime
  const at = Math.floor(now / MINUTE) * MINUTE
  if (t.bucket && t.bucket.at !== at) flush(t)
  if (!t.bucket) t.bucket = { at, sum: 0, n: 0 }
  t.bucket.sum += cpu
  t.bucket.n++
  t.idleSince = cpu < IDLE_CPU ? (t.idleSince ?? runStart(t, v => v < IDLE_CPU, now)) : null
  t.alertSince = cpu >= thr('cpu') ? (t.alertSince ?? runStart(t, v => v >= thr('cpu'), now)) : null
}

/** Start of the unbroken run of minute buckets, ending now, whose values pass `test`. */
function runStart(t: Track, test: (v: number) => boolean, now: number): number {
  let start = now,
    next = Math.floor(now / MINUTE) * MINUTE
  for (let i = t.history.length - 1; i >= 0; i--) {
    const [at, v] = t.history[i]
    if (next - at > 2 * MINUTE || !test(v)) break
    start = next = at
  }
  return start
}

function flush(t: Track) {
  const b = t.bucket
  if (!b || !b.n) return
  const last = t.history[t.history.length - 1]
  if (last && last[0] === b.at) last[1] = b.sum / b.n
  else t.history.push([b.at, b.sum / b.n])
  if (t.history.length > HISTORY) t.history.splice(0, t.history.length - HISTORY)
  t.bucket = null
}

/** Seed a track from stored history (one value per minute, oldest first), so the
    monitor curve and the idle / alert timers are right as soon as the page opens. */
export function seed(uuid: string, points: [number, number][], now = Date.now()): void {
  const t = trackOf(uuid)
  const live = t.history.filter(([at]) => at > (points.length ? points[points.length - 1][0] : 0))
  t.history = [...points.slice(-HISTORY), ...live].slice(-HISTORY)
  if (t.online) {
    if (t.idleSince != null)
      t.idleSince = Math.min(
        t.idleSince,
        runStart(t, v => v < IDLE_CPU, now),
      )
    if (t.alertSince != null)
      t.alertSince = Math.min(
        t.alertSince,
        runStart(t, v => v >= thr('cpu'), now),
      )
  }
}

/** Last `n` minute values plus the live value, for the monitor curve. */
export function curve(uuid: string, n = 30): number[] {
  const t = trackOf(uuid)
  return [...t.history.slice(-(n - 1)).map(([, v]) => v), t.cpu]
}

export function moodOf(uuid: string, now = Date.now()): Mood {
  const t = trackOf(uuid),
    hi = thr('cpu')
  if (!t.online) return 'offline'
  if (t.cpu >= hi) return t.alertSince != null && now - t.alertSince >= CALL_AFTER ? 'call' : 'alert'
  if (t.cpu >= hi * 0.75) return 'busy'
  if (t.idleSince != null && now - t.idleSince >= IDLE_AFTER) return 'idle'
  return 'work'
}
