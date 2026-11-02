/* 小剧场: duty-room moments triggered by real node events.

   observe() runs on every live tick on every page, so nothing is missed while the
   visitor is elsewhere. It folds the tick into the behaviour tracks, compares with
   the previous state and emits events: offline / recover / reboot, CPU spikes and
   the leader's phone call, long idles, packet loss, low traffic, expiry and
   100-day uptimes. Moments seen at least once are kept in this browser (图鉴). */
import { hasMetricStore, queryMetrics } from '../api/client'
import { S, visible } from '../state'
import type { KomariNode } from '../types/komari'
import { daysLeft, store } from '../utils/format'
import { metrics, trafficUsed } from '../utils/metrics'
import { type Mood, moodOf, sample, trackOf } from './behavior'
import { characterOf } from './roster'

export type MomentKind =
  'offline' | 'recover' | 'reboot' | 'spike' | 'call' | 'idle' | 'loss' | 'traffic' | 'expiry' | 'century'

export interface Moment {
  title: string
  /** Shown before discovery: what makes it happen. */
  hint: string
  /** What the worker says when it happens. */
  line: string
}

export const MOMENTS: Record<MomentKind, Moment> = {
  offline: { title: '趴桌睡着', hint: '节点掉线', line: '……zZ' },
  recover: { title: '揉眼归队', hint: '节点恢复在线', line: '我回来了！' },
  reboot: { title: '重启头晕', hint: '运行时长清零', line: '刚重启，头有点晕。' },
  spike: { title: '来活了', hint: 'CPU 越过告警阈值', line: '来活了！' },
  call: { title: '领导来电', hint: '高负载持续一分钟', line: '又来电话了，烦不烦。' },
  idle: { title: '带薪摸鱼', hint: 'CPU 低于 5% 超过 10 分钟', line: '摸会儿鱼，就一会儿。' },
  loss: { title: '拍路由器', hint: '拨测丢包', line: '网又卡了……' },
  traffic: { title: '流量见底', hint: '流量配额用掉 90%', line: '流量要省着用了。' },
  expiry: { title: '房租快到期', hint: '7 天内到期', line: '房租快到期了！' },
  century: { title: '入职一百天', hint: '连续运行满 100 天', line: '入职一百天啦！' },
}

/** Short tag and tone for the home page signal log. */
export const SIGNAL_TAG: Record<MomentKind, [string, 'bad' | 'warn' | 'good' | 'info']> = {
  offline: ['离线', 'bad'],
  recover: ['恢复', 'good'],
  reboot: ['重启', 'info'],
  spike: ['高负载', 'warn'],
  call: ['持续高负载', 'bad'],
  idle: ['空闲', 'info'],
  loss: ['丢包', 'warn'],
  traffic: ['流量', 'warn'],
  expiry: ['到期', 'warn'],
  century: ['里程碑', 'good'],
}

export interface DutyEvent {
  id: number
  at: number
  kind: MomentKind
  uuid: string
  /** Log text in the duty-room voice. */
  text: string
  /** The same event in the observatory's plain voice (home page signal log). */
  plain: string
  /** True when the condition already held the first time this page saw the node. */
  initial: boolean
}

/* ── discovered moments (图鉴) ── */
type Found = Partial<Record<MomentKind, { first: number; count: number }>>
const FOUND_KEY = 'duty-moments'
function readFound(): Found {
  try {
    const v = JSON.parse(store.get(FOUND_KEY, '{}'))
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch (e) {
    return {}
  }
}
let found = readFound()
export const discovered = (): Found => found

/* ── log and listeners ── */
const LOG_MAX = 60
const log: DutyEvent[] = []
const listeners = new Set<(e: DutyEvent) => void>()
let seq = 0
export const dutyLog = (): readonly DutyEvent[] => log
export function onDutyEvent(fn: (e: DutyEvent) => void): void {
  listeners.add(fn)
}

/* Same kind for the same node at most once per cooldown (flapping guard). */
const COOLDOWN = 5 * 60_000
const last = new Map<string, number>()
/* State-type moments (expiry, traffic, century) are announced once per page load. */
const announced = new Set<string>()

/** `say` is [duty-room voice, observatory voice]. */
function emit(n: KomariNode, kind: MomentKind, say: [string, string], initial = false, now = Date.now()) {
  const key = n.uuid + ':' + kind
  if (now - (last.get(key) ?? -Infinity) < COOLDOWN) return
  last.set(key, now)
  const e: DutyEvent = { id: ++seq, at: now, kind, uuid: n.uuid, text: say[0], plain: say[1], initial }
  log.unshift(e)
  if (log.length > LOG_MAX) log.length = LOG_MAX
  const f = found[kind]
  found = { ...readFound(), [kind]: { first: f?.first ?? now, count: (f?.count ?? 0) + 1 } }
  store.set(FOUND_KEY, JSON.stringify(found))
  listeners.forEach(fn => fn(e))
}

const DAY = 86400
/* Mood as of the previous tick; timers (idle, leader call) cross their limits between ticks. */
const moods = new Map<string, Mood>()
const pct = (v: number) => Math.round(v) + '%'

/** Fold the current live state into the tracks and emit events. Call on every live tick. */
export function observe(now = Date.now()): void {
  if (!S.lastSync) return
  visible().forEach(n => {
    const t = trackOf(n.uuid),
      was = t.online,
      wasUptime = t.uptime,
      wasMood: Mood | null = was == null ? null : (moods.get(n.uuid) ?? null),
      online = S.online.has(n.uuid),
      m = metrics(n)
    sample(n.uuid, online, m.cpu, m.uptime, now)
    const mood = moodOf(n.uuid, now)
    moods.set(n.uuid, mood)
    const who = characterOf(n.uuid).name,
      first = was == null
    if (!online) {
      if (first)
        emit(n, 'offline', [`${n.name} 离线中，${who}趴在桌上睡着了。`, `${n.name} 信号中断`], true, now)
      else if (was)
        emit(n, 'offline', [`${n.name} 掉线了，${who}趴在桌上睡着了。`, `${n.name} 失去信号`], false, now)
      return
    }
    if (was === false) {
      if (m.uptime > 0 && m.uptime < 600)
        emit(
          n,
          'reboot',
          [`${n.name} 重启后回来了，运行时长从头算起。`, `${n.name} 重启后恢复信号`],
          false,
          now,
        )
      else
        emit(n, 'recover', [`${n.name} 恢复在线，${who}揉揉眼睛回到工位。`, `${n.name} 信号恢复`], false, now)
    } else if (was && wasUptime > 600 && m.uptime > 0 && m.uptime + 120 < wasUptime)
      emit(
        n,
        'reboot',
        [`${n.name} 刚刚重启，运行时长从头算起。`, `${n.name} 已重启，运行时长归零`],
        false,
        now,
      )
    if ((mood === 'alert' || mood === 'call') && !(wasMood === 'alert' || wasMood === 'call'))
      emit(
        n,
        'spike',
        [
          `${n.name} CPU ${first ? '正处在' : '冲到'} ${pct(m.cpu)}，${who}开始冒汗。`,
          `${n.name} CPU ${first ? '处于' : '升至'} ${pct(m.cpu)}`,
        ],
        first,
        now,
      )
    if (mood === 'call' && wasMood !== 'call')
      emit(n, 'call', [`${n.name} 持续高负载，领导打来电话。`, `${n.name} 高负载持续超过 1 分钟`], false, now)
    if (mood === 'idle' && wasMood !== 'idle')
      emit(
        n,
        'idle',
        [`${n.name} 空闲超过 10 分钟，${who}溜去摸鱼了。`, `${n.name} 空闲超过 10 分钟`],
        false,
        now,
      )
    once(n, 'century', m.uptime >= 100 * DAY, () => [
      `${n.name} 已连续运行 ${Math.floor(m.uptime / DAY)} 天，入职满一百天！`,
      `${n.name} 连续运行 ${Math.floor(m.uptime / DAY)} 天`,
    ])
    if (n.traffic_limit > 0) {
      const used = (trafficUsed(n, m) / n.traffic_limit) * 100
      once(n, 'traffic', used >= 90, () => [
        `${n.name} 流量已用 ${pct(used)}，月底要省着点。`,
        `${n.name} 流量配额已用 ${pct(used)}`,
      ])
    }
    const dl = daysLeft(n.expired_at)
    once(n, 'expiry', dl != null && dl >= 0 && dl <= 7, () => [
      `${n.name} 还有 ${dl} 天到期，该交房租了。`,
      `${n.name} ${dl} 天后到期`,
    ])
  })
}

function once(n: KomariNode, kind: MomentKind, when: boolean, say: () => [string, string]) {
  const key = n.uuid + ':' + kind
  if (!when || announced.has(key)) return
  announced.add(key)
  emit(n, kind, say(), true)
}

/* ── packet loss ── */
const LOSS_WINDOW = 15 * 60_000
const LOSS_MIN = 5
let lossAt = 0

/** Check probe loss over the last 15 minutes (metric store only; at most once a minute).
    Falls back to the echo view's cached probes when the metric store is absent. */
export async function checkLoss(now = Date.now()): Promise<void> {
  if (now - lossAt < 60_000) return
  lossAt = now
  const worst = new Map<string, number>()
  if (await hasMetricStore()) {
    try {
      const ss = await queryMetrics(['ping.loss'], { hours: 1, max: 60 })
      ss.forEach(s => {
        const pts = (s.points || []).filter(
          p =>
            Number.isFinite(p.value) &&
            now - +new Date(p.time) <= LOSS_WINDOW &&
            p.value >= 0 &&
            p.value <= 1,
        )
        if (!pts.length) return
        const loss = (pts.reduce((a, p) => a + p.value, 0) / pts.length) * 100
        worst.set(s.entity_id, Math.max(worst.get(s.entity_id) ?? 0, loss))
      })
    } catch (e) {}
  } else
    Object.entries(S.echo.entries).forEach(([uuid, e]) =>
      e.tasks.forEach(t => t.loss != null && worst.set(uuid, Math.max(worst.get(uuid) ?? 0, t.loss))),
    )
  visible().forEach(n => {
    const loss = worst.get(n.uuid)
    if (loss != null && loss >= LOSS_MIN && S.online.has(n.uuid))
      emit(
        n,
        'loss',
        [
          `${n.name} 拨测丢包 ${pct(loss)}，${characterOf(n.uuid).name}拍了拍路由器。`,
          `${n.name} 拨测丢包 ${pct(loss)}`,
        ],
        false,
        now,
      )
  })
}
