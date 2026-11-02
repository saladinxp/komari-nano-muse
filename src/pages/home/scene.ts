/* Canvas renderer for one node's home.

   Layers: background (day / night by the visitor's clock) → plant → monitors,
   network lamps, calendar, TV (real data) → desk phone → snack cabinet →
   owner, guest, Nanomuse (back to front) → coffee-table top → power-cut
   shade when offline → speech. Coordinates are background pixels (layout.ts). */
import { art } from '../../cast/art'
import { curve, type Mood, moodOf, trackOf } from '../../cast/behavior'
import { fit, MONO, SANS, speech, speechBeside, sprite, sweat, text, zzz } from '../../cast/draw'
import { ATLASES, type Character, characterOf } from '../../cast/roster'
import { S, thr } from '../../state'
import type { KomariNode } from '../../types/komari'
import { fS } from '../../utils/format'
import { metrics } from '../../utils/metrics'
import {
  anchorOf,
  DESK_PHONE,
  HOME_CAST,
  HOME_POSES,
  type HomeAtlas,
  type HomePose,
  PLANT,
  SNACK_CABINET,
} from './atlas'
import {
  type Activity,
  activity,
  expiry,
  isNight,
  type Lamp,
  lampTone,
  plantStage,
  snackLevel,
} from './facts'
import { DESK_CAST, deskFrame, drawSheet, seatedScale, STOOL, STOOL_SHARE } from '../../cast/desk'
import { drawMuse, type MusePose } from '../../cast/muse'
import { deskPose } from '../../cast/routine'
import {
  CALENDAR,
  depthAt,
  CALL,
  DESK_SEAT,
  DOOR,
  LAMP_R,
  LAMPS,
  MONITORS,
  PHONE,
  PLANT_BASE,
  type Point,
  type Rect,
  SEATS,
  SNACKS,
  SOFA_DEPTH,
  STAND,
  TABLE,
  TV,
  VIEW,
  VISIT,
} from './layout'

export type Spot =
  | 'mon-cpu'
  | 'mon-mem'
  | 'mon-net'
  | 'lamps'
  | 'calendar'
  | 'tv'
  | 'plant'
  | 'snacks'
  | 'phone'
  | 'owner'
  | 'guest'
  | 'muse'

/** Where the owner is: working at the desk, on the phone, on the sofa, out of the room, asleep. */
type OwnerMode = 'desk' | 'call' | 'sofa' | 'out' | 'sleep'
interface Owner {
  x: number
  y: number
  mode: OwnerMode
  there: boolean
}

/** Why Nanomuse is visiting, or null. */
export type Visit = 'offline' | 'call' | null

interface Walker {
  x: number
  y: number
  leaving: boolean
}
interface Guest extends Walker {
  uuid: string
}
interface Muse extends Walker {
  why: Exclude<Visit, null>
  leftAt: number
}
interface Bubble {
  text: string
  until: number
}

const TONE: Record<string, string> = { off: '#2a313d', ok: '#5ee3e8', warn: '#f2c37e', bad: '#ff8fa3' }
const MOOD_COLOR: Record<Mood, string> = {
  offline: '#8497af',
  call: '#e05a73',
  alert: '#e05a73',
  busy: '#d99a3a',
  idle: '#8a7af0',
  work: '#1a919d',
}
const WALK = 150 // scene units per second

export class HomeScene {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private scale = 1
  private last = 0
  private uuid: string | null = null
  private net: [number, number][] = []
  private guest: Guest | null = null
  private muse: Muse | null = null
  private me: Owner | null = null
  private ownerBox: Rect | null = null
  private bubbles = new Map<'owner' | 'guest' | 'muse', Bubble>()
  /** Probe lines for the network panel (set by the page). */
  lamps: (Lamp | null)[] = []
  reduced = false
  /** Hit boxes from the last frame, in scene units. */
  private boxes: [Spot, Rect][] = []

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
  }

  setNode(uuid: string): void {
    if (uuid === this.uuid) return
    this.uuid = uuid
    this.net = []
    this.guest = null
    this.muse = null
    this.me = null
    this.ownerBox = null
    this.bubbles.clear()
    this.lamps = []
    this.resize()
  }

  resize(): void {
    const css = this.canvas.clientWidth || VIEW.w,
      dpr = Math.min(2, window.devicePixelRatio || 1)
    this.scale = (css * dpr) / VIEW.w
    const w = Math.round(VIEW.w * this.scale),
      h = Math.round(VIEW.h * this.scale)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
  }

  /** One live sample of the network rates for the third monitor. */
  pushNet(up: number, down: number): void {
    this.net.push([up, down])
    if (this.net.length > 48) this.net.shift()
  }

  say(who: 'owner' | 'guest' | 'muse', s: string, ms = 5000): void {
    this.bubbles.set(who, { text: s, until: performance.now() + ms })
  }

  /** Who should be on the sofa with the owner, and whether Nanomuse is visiting. */
  setCompany(guestId: string | null, visit: Visit): void {
    if (guestId && (!this.guest || this.guest.leaving || this.guest.uuid !== guestId)) {
      if (this.guest && !this.guest.leaving) this.dismissGuest()
      if (!this.guest) this.guest = { uuid: guestId, x: DOOR.x, y: DOOR.y, leaving: false }
    } else if (!guestId && this.guest && !this.guest.leaving) this.dismissGuest()
    if (visit && (!this.muse || this.muse.leaving)) {
      this.muse = { x: DOOR.x, y: DOOR.y, leaving: false, why: visit, leftAt: 0 }
      this.say(
        'muse',
        visit === 'offline' ? '断电了？我记下了，等你回来。' : '负载一直很高，我来看看。',
        6000,
      )
    } else if (!visit && this.muse && !this.muse.leaving) {
      this.muse.leaving = true
      this.muse.leftAt = performance.now()
      this.say('muse', '没事就好，我先走了。', 3500)
    }
  }

  private dismissGuest() {
    const g = this.guest
    g.leaving = true
    this.say('guest', moodOf(g.uuid) === 'idle' ? '那我先回去啦。' : '来活了！', 3000)
  }

  hit(cx: number, cy: number): Spot | null {
    const k = VIEW.w / (this.canvas.clientWidth || VIEW.w),
      x = cx * k,
      y = cy * k + VIEW.y
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const [spot, r] = this.boxes[i]
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return spot
    }
    return null
  }

  draw(now: number): void {
    const n = this.uuid && S.nodes.find(x => x.uuid === this.uuid)
    if (!n) return
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0
    this.last = now
    const ctx = this.ctx,
      wall = Date.now(),
      t = now / 1000,
      night = isNight(),
      online = S.online.has(n.uuid),
      mood = moodOf(n.uuid, wall),
      m = metrics(n),
      owner = characterOf(n.uuid)
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, -VIEW.y * this.scale)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    this.boxes = []

    const bg = art(night ? 'home-night' : 'home-day')
    if (!bg.ready) {
      ctx.fillStyle = night ? '#111e2d' : '#eef3f8'
      ctx.fillRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h)
      text(
        ctx,
        bg.failed ? '图片加载失败，请刷新重试' : '正在开门……',
        VIEW.w / 2,
        VIEW.y + VIEW.h / 2,
        26,
        '#8c9db3',
        'center',
      )
      return
    }
    ctx.drawImage(bg.img, VIEW.x, VIEW.y, VIEW.w, VIEW.h)

    /* plant: uptime, reset by a reboot */
    const stage = plantStage(m.uptime)
    this.prop(PLANT, stage, PLANT_BASE, 0.22, 'plant')

    /* desk */
    this.monitors(n.uuid, n.name, online, m, mood, t)
    this.lampsPanel(online, t)
    this.calendar(n)
    /* people appear once live data has arrived: before that the node is unknown, not offline */
    const known = trackOf(n.uuid).online != null,
      idleDo =
        known && mood === 'idle' ? activity(wall, n.uuid.length, !!this.guest && !this.guest.leaving) : null,
      me = known ? this.moveOwner(owner, mood, idleDo, dt) : null,
      seat = this.deskSeat(owner)
    this.tv(
      online && !!me && me.mode === 'sofa' && me.there && (idleDo === 'game' || idleDo === 'tv'),
      idleDo,
      t,
    )
    const ringing = mood === 'call'
    ctx.save()
    if (ringing && !this.reduced) ctx.translate(Math.sin(t * 40) * 2, 0)
    this.prop(DESK_PHONE, ringing ? 1 : 0, PHONE, 0.1, 'phone')
    ctx.restore()
    this.prop(SNACK_CABINET, snackLevel(n, m).frame, SNACKS, 0.36, 'snacks')

    /* people, back to front */
    const actors: { y: number; draw: () => void }[] = []
    if (me && !(me.mode === 'desk' && me.there))
      actors.push({ y: seat.y - 0.1, draw: () => this.stool(owner, seat) })
    this.ownerBox = null
    if (me && !(me.mode === 'out' && me.there))
      actors.push({ y: me.y, draw: () => this.owner(owner, mood, idleDo, me, wall, t, night) })
    this.walkGuest(dt, t, actors)
    this.walkMuse(dt, now, t, actors)
    actors.sort((a, b) => a.y - b.y).forEach(a => a.draw())
    const table = art(night ? 'home-table-night' : 'home-table-day')
    if (table.ready) ctx.drawImage(table.img, TABLE.x, TABLE.y, TABLE.w, TABLE.h)

    /* power cut */
    if (!online) {
      ctx.fillStyle = 'rgba(6, 10, 22, .58)'
      ctx.fillRect(VIEW.x, VIEW.y, VIEW.w, VIEW.h)
      zzz(ctx, SEATS[0].x + 60, SEATS[0].y - 170, t, '#d7dce6', this.reduced)
      if (this.muse) this.drawMuse(t)
    }

    /* speech, on top of everything */
    const say = (who: 'owner' | 'guest' | 'muse', x: number, top: number) => {
      const b = this.bubbles.get(who)
      if (b && b.until > now) speech(ctx, b.text, x, top, VIEW.w)
    }
    const ob = this.ownerBox,
      line = this.bubbles.get('owner')
    /* at the desk the monitors above carry the readings: speak beside the head, toward the room */
    if (ob && me && me.mode === 'desk' && me.there) {
      if (line && line.until > now)
        speechBeside(ctx, line.text, ob.x + ob.w / 2, ob.y + ob.h * 0.24, ob.w * 0.28, VIEW.w, 1)
    } else if (ob) say('owner', ob.x + ob.w / 2, ob.y - 6)
    if (this.guest) say('guest', this.guest.x, this.guest.y - STAND * depthAt(this.guest.y) * 0.85 - 6)
    if (this.muse) say('muse', this.muse.x, this.muse.y - STAND * depthAt(this.muse.y) * 0.95 - 6)
  }

  /* ── objects ── */
  private prop(a: HomeAtlas, i: number, at: Point, k: number, spot: Spot) {
    const sheet = art(a.art),
      f = a.frames[i],
      an = anchorOf(a, f)
    if (sheet.ready) sprite(this.ctx, sheet.img, a.scale, f, an.x, an.y, at.x, at.y, k)
    this.boxes.push([spot, { x: at.x + (f[0] - an.x) * k, y: at.y - f[3] * k, w: f[2] * k, h: f[3] * k }])
  }

  private screen(r: Rect, spot: Spot, online: boolean, body: () => void) {
    const ctx = this.ctx
    ctx.save()
    ctx.beginPath()
    ctx.rect(r.x, r.y, r.w, r.h)
    ctx.clip()
    const g = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h)
    g.addColorStop(0, online ? '#16294a' : '#07090d')
    g.addColorStop(1, online ? '#0f3a44' : '#0b0e14')
    ctx.fillStyle = g
    ctx.fillRect(r.x, r.y, r.w, r.h)
    if (online) body()
    ctx.restore()
    this.boxes.push([spot, r])
  }

  private monitors(
    uuid: string,
    name: string,
    online: boolean,
    m: ReturnType<typeof metrics>,
    mood: Mood,
    t: number,
  ) {
    const ctx = this.ctx,
      hi = thr('cpu'),
      tone = (v: number, lim: number) => (v >= lim ? '#ff8fa3' : v >= lim * 0.75 ? '#f2c37e' : '#68e0e6')
    const [a, b, c] = MONITORS
    this.screen(a, 'mon-cpu', online, () => {
      const col = tone(m.cpu, hi)
      ctx.fillStyle = MOOD_COLOR[mood]
      ctx.fillRect(a.x, a.y, 4, a.h)
      /* the server's name heads the first screen, like a login banner */
      text(ctx, fit(ctx, name, a.w - 22, 12), a.x + 12, a.y + 11, 12, '#e4ecf5', 'left', MONO, 600)
      text(ctx, 'CPU', a.x + 12, a.y + 27, 10, '#9fc3e6', 'left', MONO)
      text(ctx, m.cpu.toFixed(1) + '%', a.x + a.w - 8, a.y + 27, 14, col, 'right', MONO, 600)
      const vs = curve(uuid),
        x0 = a.x + 10,
        w = a.w - 18,
        y0 = a.y + a.h - 6,
        h = a.h - 42
      ctx.globalAlpha = 0.25
      ctx.fillStyle = '#b8d8ff'
      ctx.fillRect(x0, y0 - (h * hi) / 100, w, 1)
      ctx.globalAlpha = 1
      this.line(
        vs.map((v, i) => [
          x0 + (i / Math.max(1, vs.length - 1)) * w,
          y0 - (Math.max(0, Math.min(100, v)) / 100) * h,
        ]),
        col,
        2,
      )
    })
    this.screen(b, 'mon-mem', online, () => {
      /* readings in the top half: a seated worker's head can cover the lower half */
      const half = (b.w - 30) / 2,
        cell = (label: string, v: number, lim: number, x0: number) => {
          text(ctx, label, x0, b.y + 12, 10, '#9fc3e6', 'left', MONO)
          text(ctx, v.toFixed(0) + '%', x0 + half, b.y + 12, 11, tone(v, lim), 'right', MONO, 600)
          ctx.fillStyle = 'rgba(184, 216, 255, .15)'
          ctx.fillRect(x0, b.y + 21, half, 5)
          ctx.fillStyle = tone(v, lim)
          ctx.fillRect(x0, b.y + 21, (half * Math.min(100, v)) / 100, 5)
        }
      cell('MEM', m.ram, thr('ram'), b.x + 10)
      cell('DISK', m.disk, thr('disk'), b.x + 20 + half)
      ctx.globalAlpha = 0.18
      ctx.fillStyle = '#b8d8ff'
      for (let y = b.y + 36; y < b.y + b.h - 4; y += 9) ctx.fillRect(b.x + 10, y, b.w - 20, 1)
      ctx.globalAlpha = 1
    })
    this.screen(c, 'mon-net', online, () => {
      text(ctx, '↑ ' + fS(m.up), c.x + 10, c.y + 13, 11, '#b8c8ff', 'left', MONO)
      text(ctx, '↓ ' + fS(m.down), c.x + 10, c.y + 29, 11, '#68e0e6', 'left', MONO)
      const pts = this.net,
        max = Math.max(1, ...pts.flat()),
        x0 = c.x + 8,
        w = c.w - 16,
        y0 = c.y + c.h - 6,
        h = c.h - 44
      if (pts.length > 1)
        [0, 1].forEach(j =>
          this.line(
            pts.map((p, i) => [x0 + (i / (pts.length - 1)) * w, y0 - (p[j] / max) * h]),
            j ? '#68e0e6' : '#b8c8ff',
            1.5,
          ),
        )
      if (!this.reduced && t % 1 < 0.5) {
        ctx.fillStyle = '#68e0e6'
        ctx.fillRect(c.x + c.w - 9, c.y + 7, 4, 4)
      }
    })
  }

  private line(pts: number[][], color: string, width: number) {
    if (pts.length < 2) return
    const ctx = this.ctx
    ctx.beginPath()
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  private lampsPanel(online: boolean, t: number) {
    const ctx = this.ctx
    LAMPS.forEach((p, i) => {
      const l = this.lamps[i] || null,
        tone = online ? lampTone(l) : 'off',
        blink = tone === 'bad' && !this.reduced && t % 1 < 0.45
      ctx.fillStyle = '#1b2029'
      ctx.beginPath()
      ctx.arc(p.x, p.y, LAMP_R, 0, Math.PI * 2)
      ctx.fill()
      if (tone === 'off') return
      ctx.save()
      ctx.globalAlpha = blink ? 0.35 : 1
      ctx.shadowColor = TONE[tone]
      ctx.shadowBlur = 14
      ctx.fillStyle = TONE[tone]
      ctx.beginPath()
      ctx.arc(p.x, p.y, LAMP_R - 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    })
    const a = LAMPS[0],
      z = LAMPS[LAMPS.length - 1]
    this.boxes.push(['lamps', { x: a.x - 24, y: a.y - 24, w: z.x - a.x + 48, h: 48 }])
  }

  private calendar(n: KomariNode) {
    const ctx = this.ctx,
      r = CALENDAR,
      e = expiry(n)
    ctx.fillStyle = '#fbf7ef'
    ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.fillStyle = e.urgent ? '#c25269' : '#47698b'
    ctx.fillRect(r.x, r.y, r.w, 26)
    text(
      ctx,
      e.date ? e.date.getFullYear() + ' · ' + (e.date.getMonth() + 1) + '月' : '续费',
      r.x + r.w / 2,
      r.y + 13,
      12,
      '#ffffff',
      'center',
    )
    if (!e.date) {
      text(ctx, '长期', r.x + r.w / 2, r.y + 72, 24, '#4c5d70', 'center', SANS, 600)
      text(ctx, '无到期日', r.x + r.w / 2, r.y + 110, 12, '#697b90', 'center')
    } else {
      const cx = r.x + r.w / 2,
        cy = r.y + 66
      text(ctx, String(e.date.getDate()), cx, cy, 40, e.urgent ? '#c25269' : '#202c3c', 'center', SANS, 600)
      if (e.urgent) {
        ctx.strokeStyle = '#e05a73'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.ellipse(cx, cy + 1, 32, 27, -0.15, 0, Math.PI * 2)
        ctx.stroke()
      }
      text(
        ctx,
        e.days < 0 ? '已过期' : '剩 ' + e.days + ' 天',
        cx,
        r.y + 108,
        13,
        e.urgent ? '#c25269' : '#4c5d70',
        'center',
        SANS,
        600,
      )
      if (e.urgent && e.days >= 0) text(ctx, '房租快到期', cx, r.y + 126, 11, '#c25269', 'center')
    }
    this.boxes.push(['calendar', r])
  }

  private tv(on: boolean, show: Activity | null, t: number) {
    const ctx = this.ctx,
      xs = TV.map(p => p.x),
      ys = TV.map(p => p.y),
      box = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      }
    ctx.save()
    ctx.beginPath()
    TV.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.closePath()
    ctx.clip()
    if (!on) {
      ctx.fillStyle = '#0c111b'
      ctx.fillRect(box.x, box.y, box.w, box.h)
      const g = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h)
      g.addColorStop(0, 'rgba(255,255,255,.08)')
      g.addColorStop(0.5, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(box.x, box.y, box.w, box.h)
    } else if (show === 'game') {
      /* a little side-scroller: sky, scrolling blocks, a hopping hero */
      const sky = ctx.createLinearGradient(0, box.y, 0, box.y + box.h)
      sky.addColorStop(0, '#2b2a6e')
      sky.addColorStop(1, '#4fb6d8')
      ctx.fillStyle = sky
      ctx.fillRect(box.x, box.y, box.w, box.h)
      const ground = box.y + box.h * 0.78,
        off = this.reduced ? 0 : (t * 60) % 40
      ctx.fillStyle = '#3c9a5f'
      ctx.fillRect(box.x, ground, box.w, box.h)
      ctx.fillStyle = '#2d7a4a'
      for (let x = box.x - off; x < box.x + box.w; x += 40) ctx.fillRect(x, ground, 20, 8)
      ctx.fillStyle = '#f2c37e'
      for (let i = 0; i < 3; i++) {
        const p = ((this.reduced ? 0 : t * 60) + i * 90) % (box.w + 40),
          bx = box.x + box.w - p
        ctx.fillRect(bx, ground - 46 - i * 10, 16, 16)
      }
      const hop = this.reduced ? 0 : Math.abs(Math.sin(t * 3)) * 36
      ctx.fillStyle = '#ff8fa3'
      ctx.fillRect(box.x + 46, ground - 22 - hop, 18, 22)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(box.x + 56, ground - 17 - hop, 4, 4)
      text(
        ctx,
        'SCORE ' + String(Math.floor(t * 7) % 10000).padStart(4, '0'),
        box.x + box.w - 12,
        box.y + 40,
        12,
        '#ffffff',
        'right',
        MONO,
      )
    } else {
      /* a calm show: drifting gradient and waves */
      const g = ctx.createLinearGradient(box.x, box.y, box.x + box.w, box.y + box.h)
      g.addColorStop(0, '#8a7af0')
      g.addColorStop(1, '#1a919d')
      ctx.fillStyle = g
      ctx.fillRect(box.x, box.y, box.w, box.h)
      ctx.strokeStyle = 'rgba(255,255,255,.55)'
      ctx.lineWidth = 2
      for (let j = 0; j < 3; j++) {
        ctx.beginPath()
        for (let x = 0; x <= box.w; x += 6) {
          const y =
            box.y + box.h * (0.45 + j * 0.15) + Math.sin(x / 22 + (this.reduced ? 0 : t * 1.5) + j) * 8
          x ? ctx.lineTo(box.x + x, y) : ctx.moveTo(box.x, y)
        }
        ctx.stroke()
      }
      text(ctx, 'NANO TV', box.x + box.w / 2 + 6, box.y + 52, 15, '#ffffff', 'center', MONO, 600)
    }
    ctx.restore()
    this.boxes.push(['tv', box])
  }

  /* ── people ── */
  /** Draw a roster (duty-room) frame by its feet: idle, work, coffee or sleep. */
  private dutyFrame(c: Character, pose: 'idle' | 'work' | 'sleep', x: number, y: number, h: number) {
    const a = ATLASES[c.atlas],
      sheet = art(a.art),
      f = c.frames[pose],
      k = h / c.frames.idle[3]
    if (sheet.ready) sprite(this.ctx, sheet.img, a.scale, f, f[0] + f[2] / 2, f[1] + f[3], x, y, k)
    return { w: f[2] * k, h: f[3] * k }
  }

  /** Draw a home pose by its feet; seated poses keep their natural size. */
  private homeFrame(c: Character, pose: HomePose, x: number, y: number, depth: number) {
    const a = HOME_CAST[c.key],
      sheet = art(a.art),
      f = a.frames[HOME_POSES.indexOf(pose)],
      an = anchorOf(a, f),
      k = (STAND * depth) / a.frames[0][3]
    if (sheet.ready) sprite(this.ctx, sheet.img, a.scale, f, an.x, an.y, x, y, k)
    return { w: f[2] * k, h: f[3] * k }
  }

  /** Stool feet at the desk for this character, head centred on the middle monitor. */
  private deskSeat(c: Character): Point & { k: number } {
    const s = DESK_CAST[c.key],
      k = seatedScale(s, STAND * depthAt(DESK_SEAT.y) * DESK_SEAT.scale)
    return { x: DESK_SEAT.headX - s.head * k, y: DESK_SEAT.y, k }
  }

  private stool(c: Character, seat: Point & { k: number }) {
    const s = DESK_CAST[c.key],
      sheet = art(STOOL.art),
      k = (s.frames[0][3] * seat.k * STOOL_SHARE) / STOOL.frames[0][3]
    drawSheet(this.ctx, sheet.ready ? sheet.img : null, STOOL, 0, seat.x, seat.y, k)
  }

  /** Decide where the owner should be and walk there. Work and calls bring them
      back from the sofa or from outside at once. */
  private moveOwner(c: Character, mood: Mood, idleDo: Activity | null, dt: number): Owner {
    const mode: OwnerMode =
      mood === 'offline'
        ? 'sleep'
        : mood === 'call'
          ? 'call'
          : mood !== 'idle'
            ? 'desk'
            : idleDo === 'out'
              ? 'out'
              : 'sofa'
    const to = mode === 'desk' ? this.deskSeat(c) : mode === 'call' ? CALL : mode === 'out' ? DOOR : SEATS[0]
    if (!this.me) this.me = { x: to.x, y: to.y, mode, there: true }
    const me = this.me
    if (me.mode !== mode) {
      if (mode === 'out')
        this.say('owner', Math.floor(Date.now() / 40_000) % 2 ? '去趟洗手间。' : '出去转转。', 3000)
      else if ((mode === 'desk' || mode === 'call') && (me.mode === 'sofa' || me.mode === 'out'))
        this.say('owner', '来活了！', 2500)
      me.mode = mode
    }
    if (mode === 'sleep') Object.assign(me, { x: to.x, y: to.y, there: true })
    else me.there = this.step(me, to, dt)
    return me
  }

  private owner(
    c: Character,
    mood: Mood,
    idleDo: Activity | null,
    me: Owner,
    wall: number,
    t: number,
    night: boolean,
  ) {
    const ctx = this.ctx,
      shadow = (x: number, y: number, rx: number) => {
        ctx.fillStyle = night ? 'rgba(0,0,0,.28)' : 'rgba(40,50,70,.16)'
        ctx.beginPath()
        ctx.ellipse(x, y + 3, rx, 10, 0, 0, Math.PI * 2)
        ctx.fill()
      },
      at = (x: number, y: number, d: { w: number; h: number }): Rect => ({
        x: x - d.w / 2,
        y: y - d.h,
        w: d.w,
        h: d.h,
      })
    let box: Rect
    if (me.mode === 'sleep')
      box = at(SEATS[0].x, SEATS[0].y, this.dutyFrame(c, 'sleep', SEATS[0].x, SEATS[0].y, STAND * SOFA_DEPTH))
    else if (!me.there) {
      /* walking: front view (no walk frames for the workers yet) with a little bounce */
      const bob = this.reduced ? 0 : -Math.abs(Math.sin(t * 9)) * 5
      shadow(me.x, me.y, 50)
      box = at(me.x, me.y + bob, this.dutyFrame(c, 'idle', me.x, me.y + bob, STAND * depthAt(me.y)))
    } else if (me.mode === 'desk') {
      const seat = this.deskSeat(c),
        s = DESK_CAST[c.key],
        sheet = art(s.art)
      shadow(seat.x, seat.y, 46)
      box = drawSheet(
        ctx,
        sheet.ready ? sheet.img : null,
        s,
        deskFrame(deskPose(mood, wall, 0)),
        seat.x,
        seat.y,
        seat.k,
      )
      if (mood === 'alert' || mood === 'busy')
        sweat(ctx, box.x + box.w * 0.72, box.y + box.h * 0.12, t, mood === 'busy' ? 1 : 2, this.reduced)
    } else if (me.mode === 'call') {
      shadow(CALL.x, CALL.y, 56)
      box = at(CALL.x, CALL.y, this.homeFrame(c, 'phone', CALL.x, CALL.y, depthAt(CALL.y)))
      sweat(ctx, box.x + box.w * 0.78, box.y + box.h * 0.16, t, 2, this.reduced)
    } else
      box = at(
        SEATS[0].x,
        SEATS[0].y,
        this.homeFrame(
          c,
          (idleDo === 'out' ? 'snack' : idleDo) as HomePose,
          SEATS[0].x,
          SEATS[0].y,
          SOFA_DEPTH,
        ),
      )
    this.ownerBox = box
    this.boxes.push(['owner', box])
  }

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

  private walkGuest(dt: number, t: number, actors: { y: number; draw: () => void }[]) {
    const g = this.guest
    if (!g) return
    const arrived = this.step(g, g.leaving ? DOOR : SEATS[1], dt)
    if (g.leaving && arrived) {
      this.guest = null
      return
    }
    const c = characterOf(g.uuid)
    actors.push({
      y: g.y,
      draw: () => {
        let box
        if (arrived && !g.leaving) box = this.homeFrame(c, 'game', g.x, g.y, SOFA_DEPTH)
        else {
          const bob = this.reduced ? 0 : -Math.abs(Math.sin(t * 9)) * 5
          box = this.dutyFrame(c, 'idle', g.x, g.y + bob, STAND * depthAt(g.y))
        }
        this.boxes.push(['guest', { x: g.x - box.w / 2, y: g.y - box.h, w: box.w, h: box.h }])
      },
    })
  }

  private walkMuse(dt: number, now: number, t: number, actors: { y: number; draw: () => void }[]) {
    const mu = this.muse
    if (!mu) return
    const waving = mu.leaving && now - mu.leftAt < 2500,
      arrived = waving ? true : this.step(mu, mu.leaving ? DOOR : VISIT, dt)
    if (mu.leaving && !waving && arrived) {
      this.muse = null
      return
    }
    /* in a dark (offline) home she is drawn above the shade instead */
    if (S.online.has(this.uuid)) actors.push({ y: mu.y, draw: () => this.drawMuse(t) })
  }

  private drawMuse(t: number) {
    const mu = this.muse,
      atRest = Math.hypot(mu.x - VISIT.x, mu.y - VISIT.y) < 2,
      pose: MusePose =
        mu.leaving && atRest ? 'wave' : atRest ? (mu.why === 'call' ? 'phone' : 'tablet') : 'walk'
    const box = drawMuse(this.ctx, pose, mu.x, mu.y, STAND * depthAt(mu.y) * 0.98, t, this.reduced)
    this.boxes.push(['muse', box])
  }
}
