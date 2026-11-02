/* Canvas renderer for one duty room.

   Draw order: background → furniture strip → monitors (live data) → stools and
   workers, back rows first → speech. Everything is in scene units
   (RoomType.w × RoomType.h); the canvas transform scales it to the element.
   Monitors are drawn from real data every frame, never baked into artwork.

   Workers on duty sit at their desk with their back to the viewer (desk-v2 art).
   Idle workers face the viewer and run errands (routine.ts): a coffee beside the
   desk, a stroll, a visit to a neighbour, or the washroom. Their stool stays and
   the screen says 暂离; when work arrives they head back (返回中).

   A visit is a short chat (cast/chat.ts): an idle host comes over with a coffee
   and the two take turns talking, still facing the viewer; a working host keeps
   typing and answers over the shoulder; a host who gets busy cuts it short. */
import { S, thr } from '../../state'
import type { KomariNode } from '../../types/komari'
import { metrics } from '../../utils/metrics'
import { art } from '../../cast/art'
import { curve, type Mood, moodOf } from '../../cast/behavior'
import { deskFrame } from '../../cast/desk'
import { CHAIR, DUTY_CAST, chairSeat, drawChair, drawChairWorker, type ChairSeat } from '../../cast/chair'
import { fit, MONO, SANS, speech, speechBeside, sweat, text, zzz } from '../../cast/draw'
import { ATLASES, characterOf } from '../../cast/roster'
import {
  AT_DESK,
  awayCap,
  deskPose,
  type Errand,
  ERRAND_LINE,
  errandSeconds,
  pickErrand,
} from '../../cast/routine'
import type { Desk, Rect, Room } from './layout'
import { drawMuse, type MusePose } from '../../cast/muse'
import { drawDeskPhone } from '../../cast/phone'
import { FIRST_ROUND, patrolStops, ROUND_EVERY, type Stop } from './patrol'
import {
  chatAt,
  type ChatLine,
  chatMs,
  type ChatRole,
  chatScript,
  type HostState,
  INTERRUPTED,
  LINE_MS,
} from '../../cast/chat'

/* Monitor status edge; matches the --m-* colours in styles/10-duty.css. */
const MOOD_COLOR: Record<Mood, string> = {
  offline: '#8497af',
  call: '#e05a73',
  alert: '#e05a73',
  busy: '#d99a3a',
  idle: '#8a7af0',
  work: '#1a919d',
}
/** Walking speed, scene units per second. */
const WALK = 80

interface Point {
  x: number
  y: number
}
interface Box extends Point {
  w: number
  h: number
}

/** One side of a visit; guest and host each hold one with the same lines and start. */
interface Chat {
  partner: Worker
  role: ChatRole
  lines: readonly ChatLine[]
  /** Wall-clock ms the first line starts. */
  start: number
  /** Index of the line last put in a bubble. */
  said: number
}

interface Worker {
  node: KomariNode
  desk: Desk
  seed: number
  /** Feet on the room floor, including while seated. NaN until first placed. */
  x: number
  y: number
  errand: Errand | null
  /** Where the errand happens (feet). */
  spot: Point | null
  /** Wall-clock ms when the errand ends; 0 until the worker gets there. */
  until: number
  /** Out of the room (washroom). */
  out: boolean
  /** The colleague a visit is for. */
  target: Worker | null
  chat: Chat | null
  /** Sitting at the desk this frame. */
  seated: boolean
  /** Last drawn sprite, for hit testing and speech. */
  box: Box | null
  bubble: string
  bubbleUntil: number
}

/** Nanomuse on her rounds: walks in, stops at each desk that needs attention, notes it, leaves. */
interface Muse extends Point {
  stops: Stop[]
  i: number
  phase: 'walk' | 'note' | 'wave' | 'leave'
  until: number
  box: Box | null
  bubble: string
  bubbleUntil: number
}

export interface Hit {
  /** Node under the pointer; null when it is Nanomuse. */
  uuid: string | null
  muse?: boolean
}

export class DutyScene {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private room: Room | null = null
  private workers: Worker[] = []
  private scale = 1
  private lastFrame = 0
  private muse: Muse | null = null
  private nextRound = 0
  selected: string | null = null
  reduced = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
  }

  setRoom(room: Room): void {
    const keep = new Map(this.workers.map(w => [w.node.uuid, w]))
    const sameType = this.room && this.room.type === room.type
    this.room = room
    if (!sameType || !this.muse) {
      this.muse = null
      this.nextRound = Date.now() + FIRST_ROUND
    }
    this.workers = room.nodes.map((node, i) => {
      const desk = room.type.desks[i],
        prev = sameType ? keep.get(node.uuid) : null
      if (prev && prev.desk === desk) return { ...prev, node }
      return {
        node,
        desk,
        seed: i,
        x: NaN,
        y: NaN,
        errand: null,
        spot: null,
        until: 0,
        out: false,
        target: null,
        chat: null,
        seated: false,
        box: null,
        bubble: prev ? prev.bubble : '',
        bubbleUntil: prev ? prev.bubbleUntil : 0,
      }
    })
    /* kept workers are copies: point visits and chats at the new objects, drop the rest */
    const byId = new Map(this.workers.map(w => [w.node.uuid, w]))
    this.workers.forEach(w => {
      w.target = (w.target && byId.get(w.target.node.uuid)) || null
      const p = w.chat && byId.get(w.chat.partner.node.uuid)
      w.chat = p ? { ...w.chat, partner: p } : null
    })
    this.resize()
  }

  get current(): Room | null {
    return this.room
  }

  /** Geometry used by the offline preview's placement checks. */
  seatsForQA() {
    return this.workers.map(w => ({
      uuid: w.node.uuid,
      character: characterOf(w.node.uuid).key,
      row: w.desk.row,
      floor: w.desk.chairFloor,
      standingFloor: w.desk.y,
      seat: this.seat(w),
      seated: w.seated,
      where: this.where(w.node.uuid),
      box: w.box,
      screen: w.desk.screen,
      art: DUTY_CAST[characterOf(w.node.uuid).key].art,
    }))
  }

  /** Match the backing store to the element size (device pixels, capped at 2×). */
  resize(): void {
    if (!this.room) return
    const { w, h } = this.room.type,
      css = this.canvas.clientWidth || w,
      dpr = Math.min(2, window.devicePixelRatio || 1)
    this.scale = (css * dpr) / w
    const pw = Math.round(w * this.scale),
      ph = Math.round(h * this.scale)
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw
      this.canvas.height = ph
    }
  }

  say(uuid: string, s: string, ms = 5000): void {
    const w = this.workers.find(x => x.node.uuid === uuid)
    if (w) this.bubble(w, s, ms)
  }

  private bubble(w: Worker, s: string, ms: number) {
    w.bubble = s
    w.bubbleUntil = performance.now() + ms
  }

  /** Whether a worker is at the desk, chatting away from it, away on an errand, or out of the room. */
  where(uuid: string): 'desk' | 'chat' | 'away' | 'out' {
    const w = this.workers.find(x => x.node.uuid === uuid)
    return !w || w.seated ? 'desk' : w.out ? 'out' : w.chat ? 'chat' : 'away'
  }

  /** Worker or monitor under a point given in CSS pixels relative to the canvas. */
  hit(cx: number, cy: number): Hit | null {
    if (!this.room) return null
    const k = this.room.type.w / (this.canvas.clientWidth || this.room.type.w),
      x = cx * k,
      y = cy * k
    const mb = this.muse && this.muse.box
    if (mb && x >= mb.x && x <= mb.x + mb.w && y >= mb.y && y <= mb.y + mb.h)
      return { uuid: null, muse: true }
    const order = this.workers.filter(w => w.box).sort((a, b) => b.y - a.y)
    for (const w of order) {
      const b = w.box
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h + 12) return { uuid: w.node.uuid }
    }
    for (const w of this.workers) {
      const s = w.desk.screen
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return { uuid: w.node.uuid }
    }
    return null
  }

  /** Draw one frame. `now` is performance.now(). */
  draw(now: number): void {
    const room = this.room
    if (!room) return
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0
    this.lastFrame = now
    const ctx = this.ctx,
      { w: W, h: H } = room.type,
      night = document.documentElement.dataset.theme === 'dark',
      wall = Date.now()
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const bg = art(night ? room.type.night : room.type.day),
      front = room.type.front ? art(room.type.front.art) : null
    if (!bg.ready || (front && !front.ready)) {
      ctx.fillStyle = night ? '#111e2d' : '#eef3f8'
      ctx.fillRect(0, 0, W, H)
      text(
        ctx,
        bg.failed ? '值班室图片加载失败，请刷新重试' : '正在打开值班室……',
        W / 2,
        H / 2,
        26,
        night ? '#8c9db3' : '#697b90',
        'center',
        SANS,
      )
      return
    }
    ctx.drawImage(bg.img, 0, 0, W, H)
    if (front) {
      const d = room.type.front.dest
      if (night) ctx.filter = 'brightness(.72) saturate(.85)'
      ctx.drawImage(front.img, d.x, d.y, d.w, d.h)
      ctx.filter = 'none'
    }

    const moods = new Map(this.workers.map(w => [w, moodOf(w.node.uuid, wall)]))
    this.workers.forEach(w => this.update(w, moods, dt, wall))
    this.workers.forEach(w => w.chat && w.chat.role === 'guest' && this.talk(w, wall))
    this.patrol(dt, wall)

    const byDesk = new Map(this.workers.map(w => [w.desk, w]))
    room.type.desks.forEach(d => this.screen(d.screen, byDesk.get(d), wall))
    /* the leader's call rings on the desk, behind the seated worker */
    this.workers.forEach(w => moods.get(w) === 'call' && this.deskPhone(w.desk, now / 1000))

    /* Floor anchors sort walkers and chairs; the occupied backrest is in front
       of the seated sprite, while an empty chair stays behind passing workers. */
    const layer: { y: number; draw: () => void }[] = []
    this.workers.forEach(w => {
      const mood = moods.get(w),
        seat = this.seat(w)
      layer.push({ y: seat.y + (w.seated ? 0.1 : -0.1), draw: () => this.chair(w, seat, night) })
      if (!w.out) layer.push({ y: w.y, draw: () => this.worker(w, mood, now, wall, night) })
      else w.box = null
    })
    const mu = this.muse
    if (mu) layer.push({ y: mu.y, draw: () => this.drawPatrol(mu, now) })
    layer.sort((a, b) => a.y - b.y).forEach(l => l.draw())
    this.workers.forEach(w => {
      const b = w.box
      if (!(w.bubbleUntil > now && b)) return
      if (!w.seated) return speech(ctx, w.bubble, b.x + b.w / 2, b.y - 8, W)
      /* seated under their own monitor: speak beside the head so the readings stay visible;
         in a chat the guest stands on one side, so open on the other, else toward the room's middle */
      const toward = w.chat ? w.x - w.chat.partner.x : W / 2 - w.x
      speechBeside(ctx, w.bubble, b.x + b.w / 2, b.y + b.h * 0.24, b.w * 0.28, W, toward >= 0 ? 1 : -1)
    })
    if (mu && mu.box && mu.bubbleUntil > now) speech(ctx, mu.bubble, mu.box.x + mu.box.w / 2, mu.box.y - 8, W)
  }

  /* ── places ── */
  /** Movement targets the floor; the seated body uses a separate hip anchor. */
  private seat(w: Worker): ChairSeat {
    return chairSeat(DUTY_CAST[characterOf(w.node.uuid).key], w.desk)
  }

  /** Standing spot beside a desk, on the side given by `side`. */
  private beside(w: Worker, side: number): Point {
    const W = this.room.type.w,
      x = w.desk.x + side * 0.55 * w.desk.size
    return { x: Math.max(40, Math.min(W - 40, x)), y: w.desk.y + 0.04 * w.desk.size }
  }

  /* ── behaviour ── */
  private update(w: Worker, moods: Map<Worker, Mood>, dt: number, wall: number) {
    const mood = moods.get(w),
      seat = this.seat(w)
    if (Number.isNaN(w.x)) {
      w.x = seat.x
      w.y = seat.y
    }
    if (mood === 'offline') {
      this.endChat(w)
      Object.assign(w, {
        errand: null,
        spot: null,
        out: false,
        target: null,
        seated: false,
        x: seat.x,
        y: seat.y,
      })
      return
    }
    if (AT_DESK.has(mood)) {
      const hosting = w.chat && w.chat.role === 'host'
      /* a host who gets work (or more work) mid-chat says so; the guest then leaves */
      if (hosting && w.chat.lines !== INTERRUPTED && (w.errand || mood !== 'work')) this.interrupt(w, wall)
      if (w.errand) {
        if (!w.out && !hosting) this.bubble(w, '来活了！', 2500)
        if (!hosting) this.endChat(w, '去吧去吧。')
        Object.assign(w, { errand: null, spot: null, out: false, target: null })
      }
      w.seated = this.step(w, seat, dt)
      return
    }
    /* idle: errands, facing the viewer */
    w.seated = false
    if (!w.errand) this.startErrand(w, moods)
    if (w.out) {
      if (wall >= w.until) Object.assign(w, { out: false, errand: null, spot: null })
      return
    }
    if (this.step(w, w.spot, dt)) {
      if (!w.until) {
        w.until = wall + errandSeconds(w.errand, Math.random()) * 1000
        if (w.errand === 'toilet') w.out = true
        if (w.errand === 'visit') this.startChat(w, moods, wall)
      } else if (wall >= w.until && !(w.chat && w.chat.role === 'host')) {
        this.endChat(w)
        Object.assign(w, { errand: null, spot: null, target: null })
      }
    }
  }

  /* ── visits ── */
  /** The guest has arrived at the host's desk: pick the lines and, if the host is free, call them over. */
  private startChat(guest: Worker, moods: Map<Worker, Mood>, wall: number) {
    const host = guest.target
    if (!host || host.chat || !this.workers.includes(host)) return
    const hm = moods.get(host),
      free = hm === 'idle' && !host.out && (!host.errand || host.errand === 'coffee'),
      state: HostState =
        hm === 'offline'
          ? 'asleep'
          : hm === 'work'
            ? 'work'
            : AT_DESK.has(hm)
              ? 'busy'
              : free
                ? 'idle'
                : 'away',
      live = S.live[host.node.uuid],
      lines = chatScript(
        {
          host: state,
          name: characterOf(host.node.uuid).name,
          cpu: metrics(host.node).cpu,
          days: live && live.uptime ? live.uptime / 86400 : 0,
        },
        Math.random(),
      )
    guest.until = wall + chatMs(lines) + (state === 'away' ? 5000 : 1200)
    guest.chat = { partner: host, role: 'guest', lines, start: wall, said: -1 }
    if (state === 'away' || state === 'asleep') return
    host.chat = { partner: guest, role: 'host', lines, start: wall, said: -1 }
    if (state !== 'idle') return
    /* an idle host brings their coffee over and stands beside the guest, between them and the desk */
    const toDesk = Math.sign(host.desk.x - guest.x) || 1,
      W = this.room.type.w
    Object.assign(host, {
      errand: 'coffee',
      spot: { x: Math.max(40, Math.min(W - 40, guest.x + toDesk * 0.5 * host.desk.size)), y: guest.y },
      until: guest.until + 1500,
    })
  }

  /** Put the current line of a chat in a bubble, one speaker at a time. Driven from the guest's side. */
  private talk(guest: Worker, wall: number) {
    const c = guest.chat,
      at = chatAt(c.lines, wall - c.start)
    if (!at || at.index === c.said) return
    c.said = at.index
    const host = c.partner,
      who = at.line.by === 'guest' ? guest : host,
      other = who === guest ? host : guest
    if (host.chat) host.chat.said = at.index
    this.bubble(who, at.line.text, LINE_MS - 150)
    if (other.chat) other.bubbleUntil = 0
  }

  /** The host got work: both switch to the short goodbye and the guest leaves after it. */
  private interrupt(host: Worker, wall: number) {
    const guest = host.chat.partner
    ;[host, guest].forEach(x => {
      if (x.chat) Object.assign(x.chat, { lines: INTERRUPTED, start: wall, said: -1 })
    })
    guest.until = wall + chatMs(INTERRUPTED) + 300
  }

  /** End a chat on both sides; `bye` is what the other one says, if anything. */
  private endChat(w: Worker, bye = '') {
    const c = w.chat
    if (!c) return
    w.chat = null
    if (c.partner.chat && c.partner.chat.partner === w) {
      c.partner.chat = null
      if (bye) this.bubble(c.partner, bye, 2000)
    }
  }

  private startErrand(w: Worker, moods: Map<Worker, Mood>) {
    const W = this.room.type.w,
      others = this.workers.filter(o => o !== w && moods.get(o) !== 'offline'),
      away = this.workers.filter(o => o.errand && o.errand !== 'coffee').length,
      nb = others.sort(
        (a, b) =>
          Math.hypot(a.desk.x - w.desk.x, a.desk.y - w.desk.y) -
          Math.hypot(b.desk.x - w.desk.x, b.desk.y - w.desk.y),
      )[0]
    const e = pickErrand(Math.random(), { neighbour: !!nb, away, cap: awayCap(this.workers.length) })
    const side = w.seed % 2 ? 1 : -1
    w.errand = e
    w.until = 0
    w.target = e === 'visit' ? nb : null
    w.spot =
      e === 'coffee'
        ? this.beside(w, side)
        : e === 'visit'
          ? this.beside(nb, nb.desk.x > w.desk.x ? -1 : 1)
          : e === 'toilet'
            ? { x: w.desk.x < W / 2 ? -90 : W + 90, y: w.desk.y }
            : {
                x: W * (0.1 + Math.random() * 0.8),
                y: w.desk.y + (0.02 + Math.random() * 0.08) * w.desk.size,
              }
    if (ERRAND_LINE[e] && (e !== 'stroll' || Math.random() < 0.5)) this.bubble(w, ERRAND_LINE[e], 3000)
  }

  /** Walk toward `to`; true once there. */
  private step(w: Point, to: Point, dt: number): boolean {
    const dx = to.x - w.x,
      dy = to.y - w.y,
      d = Math.hypot(dx, dy)
    if (d < 2 || this.reduced) {
      w.x = to.x
      w.y = to.y
      return true
    }
    const s = Math.min(d, dt * WALK)
    w.x += (dx / d) * s
    w.y += (dy / d) * s
    return false
  }

  /* ── monitors ── */
  private screen(r: Rect, w: Worker | undefined, wall: number) {
    const ctx = this.ctx
    ctx.save()
    ctx.beginPath()
    ctx.rect(r.x, r.y, r.w, r.h)
    ctx.clip()
    if (!w) {
      ctx.fillStyle = '#1a2230'
      ctx.fillRect(r.x, r.y, r.w, r.h)
      ctx.restore()
      return
    }
    const n = w.node,
      online = S.online.has(n.uuid),
      m = metrics(n),
      hi = thr('cpu'),
      mood = moodOf(n.uuid, wall)
    const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h)
    g.addColorStop(0, online ? '#16294a' : '#262c36')
    g.addColorStop(1, online ? '#0f3a44' : '#1d222b')
    ctx.fillStyle = g
    ctx.fillRect(r.x, r.y, r.w, r.h)
    /* status edge: the monitor carries the node name, so it also carries the colour */
    ctx.fillStyle = MOOD_COLOR[mood]
    ctx.fillRect(r.x, r.y, Math.max(3, r.w * 0.035), r.h)
    const fs = Math.max(8, Math.min(13, r.w * 0.085)),
      pad = r.w * 0.09
    text(
      ctx,
      fit(ctx, n.name, r.w - pad * 2, fs),
      r.x + pad,
      r.y + r.h * 0.17,
      fs,
      '#dce9ff',
      'left',
      MONO,
      600,
    )
    if (!online) {
      text(this.ctx, 'OFFLINE', r.x + r.w / 2, r.y + r.h * 0.55, fs * 1.1, '#ef91a1', 'center', MONO)
      ctx.restore()
      return
    }
    const accent = m.cpu >= hi ? '#ff8fa3' : m.cpu >= hi * 0.75 ? '#f2c37e' : '#68e0e6'
    text(
      this.ctx,
      'CPU ' + Math.round(m.cpu) + '%',
      r.x + pad,
      r.y + r.h * 0.42,
      fs * 1.12,
      accent,
      'left',
      MONO,
    )
    text(
      this.ctx,
      'RAM ' + Math.round(m.ram) + '%',
      r.x + r.w - pad,
      r.y + r.h * 0.42,
      fs * 0.82,
      '#b8c8ff',
      'right',
      MONO,
    )
    /* CPU curve, absolute 0–100 % like every other chart in the theme */
    const vs = curve(n.uuid),
      bx = r.x + pad,
      bw = r.w - pad * 2,
      by = r.y + r.h * 0.94,
      bh = r.h * 0.36
    ctx.globalAlpha = 0.18
    ctx.fillStyle = '#b8d8ff'
    ctx.fillRect(bx, by - bh * (hi / 100), bw, 1)
    ctx.globalAlpha = 1
    if (vs.length > 1) {
      ctx.beginPath()
      vs.forEach((v, i) => {
        const x = bx + (i / (vs.length - 1)) * bw,
          y = by - (Math.max(0, Math.min(100, v)) / 100) * bh
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
      })
      ctx.strokeStyle = accent
      ctx.lineWidth = Math.max(1, r.w * 0.012)
      ctx.stroke()
    }
    if (!w.seated) {
      const label = mood === 'idle' ? '暂离' : '返回中',
        tw = r.w * (label.length > 2 ? 0.44 : 0.34)
      ctx.fillStyle = 'rgba(15, 25, 40, .8)'
      ctx.fillRect(r.x + r.w - tw, r.y, tw, r.h * 0.26)
      text(ctx, label, r.x + r.w - tw / 2, r.y + r.h * 0.13, fs * 0.85, '#f2c37e', 'center', SANS)
    }
    ctx.restore()
  }

  /* ── Nanomuse's rounds ── */
  /** Floor line in the middle of the room, where she enters and crosses. */
  private aisle(): Point {
    const d = this.room.type.desks,
      mid = d[Math.floor(d.length / 2)]
    return { x: this.room.type.w / 2, y: mid.y + 0.12 * mid.size }
  }

  /** Worker height at a floor y: that of the nearest desk row. */
  private sizeAt(y: number): number {
    return this.room.type.desks.reduce((a, d) => (Math.abs(d.y - y) < Math.abs(a.y - y) ? d : a)).size
  }

  private patrol(dt: number, wall: number) {
    const room = this.room,
      door = { x: room.type.w + 90, y: this.aisle().y }
    if (!this.muse) {
      if (wall < this.nextRound || !room.nodes.length || !S.lastSync) return
      this.nextRound = wall + ROUND_EVERY
      this.muse = {
        ...door,
        stops: patrolStops(room.nodes, wall),
        i: 0,
        phase: 'walk',
        until: 0,
        box: null,
        bubble: '',
        bubbleUntil: 0,
      }
      return
    }
    const mu = this.muse,
      say = (s: string) => {
        mu.bubble = s
        mu.bubbleUntil = performance.now() + 3800
      }
    if (mu.phase === 'walk' || mu.phase === 'leave') {
      const stop = mu.stops[mu.i],
        w = stop && this.workers.find(x => x.node.uuid === stop.uuid),
        to =
          mu.phase === 'leave'
            ? door
            : w
              ? {
                  x: Math.min(room.type.w - 50, w.desk.x + 0.6 * w.desk.size),
                  y: w.desk.y + 0.12 * w.desk.size,
                }
              : this.aisle()
      if (!this.step(mu, to, dt)) return
      if (mu.phase === 'leave') {
        this.muse = null
        return
      }
      if (stop) {
        mu.phase = 'note'
        mu.until = wall + 4200
        say(stop.line)
      } else {
        mu.phase = 'wave'
        mu.until = wall + 3000
        say('全员在岗。')
      }
    } else if (wall >= mu.until) {
      mu.i++
      if (mu.phase === 'wave') mu.phase = 'leave'
      else if (mu.i < mu.stops.length) mu.phase = 'walk'
      else {
        mu.phase = 'wave'
        mu.until = wall + 2500
        say('先记这些，我走啦。')
      }
    }
  }

  private drawPatrol(mu: Muse, now: number) {
    const moving = mu.phase === 'walk' || mu.phase === 'leave',
      pose: MusePose = moving ? 'walk' : mu.phase === 'note' ? 'tablet' : 'wave'
    mu.box = drawMuse(this.ctx, pose, mu.x, mu.y, this.sizeAt(mu.y) * 1.02, now / 1000, this.reduced)
  }

  /* ── workers ── */
  private chair(w: Worker, seat: ChairSeat, night: boolean) {
    const sheet = art(CHAIR.art)
    this.ground(seat.x, seat.y, w.desk.size * 0.2, night)
    if (!sheet.ready) return
    this.ctx.save()
    if (night) this.ctx.filter = 'brightness(.8) saturate(.9)'
    drawChair(this.ctx, sheet.img, seat)
    this.ctx.restore()
  }

  private worker(w: Worker, mood: Mood, now: number, wall: number, night: boolean) {
    const ctx = this.ctx,
      c = characterOf(w.node.uuid),
      t = now / 1000,
      size = w.desk.size
    let box: Box
    ctx.save()
    if (w.seated) {
      const s = DUTY_CAST[c.key],
        sheet = art(s.art),
        k = this.seat(w).k
      box = drawChairWorker(
        ctx,
        sheet.ready ? sheet.img : null,
        s,
        deskFrame(deskPose(mood, wall, w.seed)),
        w.x,
        this.seat(w).hipY,
        k,
      )
      if (!sheet.ready) this.placeholder(c.color, box)
    } else {
      /* front views from the 摸鱼机房 atlases: standing, coffee, sleeping, walking */
      const walking = !!w.spot && Math.hypot(w.spot.x - w.x, w.spot.y - w.y) > 2,
        pose = mood === 'offline' ? 'sleep' : !walking && w.errand === 'coffee' ? 'coffee' : 'idle',
        a = ATLASES[c.atlas],
        sheet = art(a.art),
        f = c.frames[pose],
        k = size / c.frames.idle[3],
        bob =
          this.reduced || mood === 'offline'
            ? 0
            : walking
              ? -Math.abs(Math.sin(t * 9)) * 4
              : Math.sin(t * 2 + w.seed) * 1.2,
        dw = f[2] * k,
        dh = f[3] * k
      this.ground(w.x, w.y, dw * 0.3, night)
      if (mood === 'offline') ctx.globalAlpha = 0.72
      box = { x: w.x - dw / 2, y: w.y + bob - dh, w: dw, h: dh }
      /* the one speaking in a chat leans a little toward the other, still facing us */
      const talk = w.chat,
        line = talk && !walking && chatAt(talk.lines, wall - talk.start)
      if (line && line.line.by === talk.role) {
        ctx.translate(w.x, w.y)
        ctx.rotate((Math.sign(talk.partner.x - w.x) || 1) * 0.05)
        ctx.translate(-w.x, -w.y)
      }
      if (sheet.ready)
        ctx.drawImage(
          sheet.img,
          f[0] * a.scale,
          f[1] * a.scale,
          f[2] * a.scale,
          f[3] * a.scale,
          box.x,
          box.y,
          dw,
          dh,
        )
      else this.placeholder(c.color, box)
      ctx.globalAlpha = 1
    }
    if (this.selected === w.node.uuid) {
      ctx.strokeStyle = '#5ad8e6'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.ellipse(w.x, w.y + 3, Math.max(28, box.w * 0.36), 10, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    if (w.seated && (mood === 'alert' || mood === 'call' || mood === 'busy'))
      sweat(ctx, box.x + box.w * 0.72, box.y + box.h * 0.12, t, mood === 'busy' ? 1 : 2, this.reduced)
    if (mood === 'offline')
      zzz(ctx, box.x + box.w * 0.86, box.y - 2, t, night ? '#d7dce6' : '#738398', this.reduced)
    ctx.restore()
    w.box = box
  }

  private ground(x: number, y: number, rx: number, night: boolean) {
    const ctx = this.ctx
    ctx.fillStyle = night ? 'rgba(0, 0, 0, .28)' : 'rgba(40, 50, 70, .16)'
    ctx.beginPath()
    ctx.ellipse(x, y + 3, rx, 7, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  private placeholder(color: string, b: Box) {
    this.ctx.fillStyle = color
    this.ctx.fillRect(b.x + b.w * 0.25, b.y + b.h * 0.4, b.w * 0.5, b.h * 0.6)
  }

  /** The ringing desk phone (home-v1 art) on the desk's left, left of the keyboard. */
  private deskPhone(d: Desk, t: number) {
    const ctx = this.ctx,
      shake = this.reduced ? 0 : Math.sin(t * 40) * 1.5,
      x = d.screen.x - 0.02 * d.size + shake,
      y = d.screen.y + d.screen.h + 0.15 * d.size
    if (!drawDeskPhone(ctx, true, x, y, 0.3 * d.size)) this.phone(x, y - 15, t)
  }

  /** Fallback while the phone art loads: square handset glyph with vibration marks. */
  private phone(x: number, y: number, t: number) {
    const ctx = this.ctx,
      shake = this.reduced ? 0 : Math.sin(t * 40) * 2
    ctx.save()
    ctx.translate(x + shake, y)
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#c25269'
    ctx.lineWidth = 2
    ctx.fillRect(-15, -15, 30, 30)
    ctx.strokeRect(-15, -15, 30, 30)
    ctx.fillStyle = '#c25269'
    ctx.fillRect(-9, -7, 18, 5)
    ctx.fillRect(-9, -7, 5, 12)
    ctx.fillRect(4, -7, 5, 12)
    ctx.fillRect(-6, 5, 12, 4)
    ctx.beginPath()
    ctx.moveTo(-21, -10)
    ctx.lineTo(-26, -14)
    ctx.moveTo(-21, 0)
    ctx.lineTo(-27, 0)
    ctx.moveTo(21, -10)
    ctx.lineTo(26, -14)
    ctx.moveTo(21, 0)
    ctx.lineTo(27, 0)
    ctx.stroke()
    ctx.restore()
  }
}
