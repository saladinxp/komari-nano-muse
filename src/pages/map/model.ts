/* Star Map geometry and link status, free of DOM so qa/test-map-beta6.mjs can check it.
   Base coordinates are the 960×480 Mercator space of WMAP_LAND; the page maps them
   to screen pixels with one uniform scale, so dots and text keep a fixed size. */
import type { EchoSite } from '../../data/echo-sites'
import { ISO_COORDS, NAME_HINTS, type LatLng } from '../../data/places'
import { echoCells, type EchoTrendTask } from '../../nodes/echo-trend'
import { regionCode } from '../../utils/format'

export const BASE_W = 960
export const BASE_H = 480
const LAT_MIN = -60
const LAT_MAX = 83

export interface Point {
  x: number
  y: number
}
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
export function project(lat: number, lng: number): Point {
  lat = Math.max(LAT_MIN, Math.min(LAT_MAX, lat))
  return {
    x: ((lng + 180) / 360) * BASE_W,
    y: (BASE_H * (merc(LAT_MAX) - merc(lat))) / (merc(LAT_MAX) - merc(LAT_MIN)),
  }
}

/* ── where a node is ── */
export interface Locatable {
  uuid: string
  name?: string
  region?: string
}
const HINT_KEYS = Object.keys(NAME_HINTS).sort((a, b) => b.length - a.length)

function fromSetting(uuid: string, setting: string): LatLng | null {
  for (const pair of (setting || '').split(';')) {
    const kv = pair.trim().split(':')
    if (kv.length !== 2 || kv[0].trim() !== uuid) continue
    const [lat, lng] = kv[1].split(',').map(parseFloat)
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng]
  }
  return null
}
/* Nodes sharing one point fan out on a golden-angle spiral, ~0.35–0.5° apart. */
function spread([lat, lng]: LatLng, idx: number, radius: number): LatLng {
  if (idx === 0) return [lat, lng]
  const angle = (idx - 1) * 2.399,
    r = radius * Math.ceil(idx / 6) * 0.6
  return [lat + Math.sin(angle) * r, lng + Math.cos(angle) * r]
}
/** node_coords setting → a city named in the node name → the region's country point. */
export function locate(n: Locatable, setting: string, used: Map<string, number>): LatLng | null {
  const own = fromSetting(n.uuid, setting)
  if (own) return own
  const name = n.name || ''
  const hint = HINT_KEYS.find(k => name.includes(k))
  const base = hint ? NAME_HINTS[hint] : ISO_COORDS[regionCode(n.region)]
  if (!base) return null
  const key = base.join(',')
  const idx = used.get(key) || 0
  used.set(key, idx + 1)
  return spread(base, idx, hint ? 0.35 : 0.5)
}

/* ── auto zoom ── */
export interface FitOptions {
  aspect?: number
  /** Widest the view may get when the points span more latitude than the aspect allows. */
  minAspect?: number
  pad?: number
  minWidth?: number
}
/* Bounding box of the points plus padding, widened to the target aspect and kept
   inside the world. With no points the whole map shows (poles cropped). */
export function fitView(points: Point[], o: FitOptions = {}): Rect {
  const aspect = o.aspect ?? 2.3,
    minAspect = o.minAspect ?? 2,
    minWidth = o.minWidth ?? 210
  if (!points.length) {
    const h = BASE_W / aspect
    return { x: 0, y: Math.max(0, (BASE_H - h) / 2 - 16), w: BASE_W, h }
  }
  const xs = points.map(p => p.x),
    ys = points.map(p => p.y)
  let x0 = Math.min(...xs),
    x1 = Math.max(...xs),
    y0 = Math.min(...ys),
    y1 = Math.max(...ys)
  const pad = o.pad ?? Math.max(24, 0.07 * Math.max(x1 - x0, y1 - y0))
  x0 -= pad
  x1 += pad
  y0 -= pad
  y1 += pad
  let w = Math.max(x1 - x0, minWidth),
    h = y1 - y0
  if (w / h < aspect) w = h * aspect
  else h = w / aspect
  if (w > BASE_W) {
    w = BASE_W
    h = Math.min(Math.max(y1 - y0, BASE_W / aspect), BASE_W / minAspect, BASE_H)
  }
  if (h > BASE_H) h = BASE_H
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2
  const x = Math.max(0, Math.min(BASE_W - w, cx - w / 2)),
    y = Math.max(0, Math.min(BASE_H - h, cy - h / 2))
  return { x, y, w, h }
}
export function toScreen(p: Point, view: Rect, width: number): Point {
  const k = width / view.w
  return { x: (p.x - view.x) * k, y: (p.y - view.y) * k }
}

/* ── arcs ── */
/* Quadratic curve control point: bulges north (up) by a share of the distance;
   nearly north–south links bend west. Shape is scale-free, so base and screen agree. */
export function arcControl(a: Point, b: Point, bend = 0.2): Point {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    d = Math.hypot(dx, dy) || 1
  let nx = -dy / d,
    ny = dx / d
  if (Math.abs(ny) < 0.2 ? nx > 0 : ny > 0) {
    nx = -nx
    ny = -ny
  }
  return { x: (a.x + b.x) / 2 + nx * d * bend, y: (a.y + b.y) / 2 + ny * d * bend }
}
/** Highest point of the curve (t = 0.5), used to keep arcs inside the auto-zoom view. */
export function arcApex(a: Point, b: Point, bend = 0.2): Point {
  const c = arcControl(a, b, bend)
  return { x: 0.25 * a.x + 0.5 * c.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * c.y + 0.25 * b.y }
}
export function arcPath(a: Point, b: Point, bend = 0.2): string {
  const c = arcControl(a, b, bend),
    n = (v: number) => v.toFixed(1)
  return `M${n(a.x)} ${n(a.y)}Q${n(c.x)} ${n(c.y)} ${n(b.x)} ${n(b.y)}`
}

/* ── link status: same cells, same rules as the Echo trend ── */
export type LineQuality = 'stable' | 'unstable' | 'lost' | 'missing'
export type LinkQuality = LineQuality | 'offline' | 'none'
export interface LinkLine {
  name: string
  task?: EchoTrendTask & { avg?: number | null }
  message?: string
}

/* One line over the last hour: grey without observations; red when every observed
   cell is lost or the latest three are (currently failing); amber when any cell is
   unstable or lost (spike, partial or full loss); otherwise cyan. */
export function lineQuality(task: EchoTrendTask | undefined, now: number): LineQuality {
  if (!task) return 'missing'
  const seen = echoCells(task, now, 60).filter(c => c.quality !== 'missing' && c.quality !== 'pending')
  if (!seen.length) return 'missing'
  if (
    seen.every(c => c.quality === 'lost') ||
    (seen.length >= 3 && seen.slice(-3).every(c => c.quality === 'lost'))
  )
    return 'lost'
  return seen.some(c => c.quality !== 'stable') ? 'unstable' : 'stable'
}
/* A node's arc. `none` (dot only): default lines not enabled, or this node has no
   domestic line at all (not assigned / waiting for the administrator). `offline`
   and `missing` draw a grey dashed arc. Otherwise red only when every line with data
   is lost; one lost or wavering carrier makes the arc amber, never hides it. */
export function nodeLink(lines: LinkLine[], online: boolean, now: number): LinkQuality {
  if (!lines.some(l => l.task || l.message === '等待采样')) return 'none'
  if (!online) return 'offline'
  const q = lines.map(l => lineQuality(l.task, now)).filter(v => v !== 'missing')
  if (!q.length) return 'missing'
  if (q.every(v => v === 'lost')) return 'lost'
  return q.every(v => v === 'stable') ? 'stable' : 'unstable'
}
const RANK: Record<LinkQuality, number> = { lost: 5, unstable: 4, stable: 3, missing: 2, offline: 1, none: 0 }
/** Region summary: the worst link among its nodes. */
export function worstLink(qs: LinkQuality[]): LinkQuality {
  return qs.reduce<LinkQuality>((a, b) => (RANK[b] > RANK[a] ? b : a), 'none')
}
/** Answered latencies of the last hour (timeouts and full-loss samples excluded). */
export function answered(task: EchoTrendTask | undefined): number[] {
  return (task?.samples || task?.points || [])
    .filter(
      p => typeof p.lat === 'number' && Number.isFinite(p.lat) && p.lat >= 0 && !p.timeout && p.loss !== 1,
    )
    .map(p => p.lat)
}
export function median(values: number[]): number | null {
  if (!values.length) return null
  const v = [...values].sort((a, b) => a - b),
    m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** Where the domestic default targets are, or null when none has a known place. */
export function arcTarget(
  targets: { key: string; target: string }[],
  sites: Record<string, EchoSite>,
  keys: readonly string[],
): EchoSite | null {
  for (const t of targets) if (keys.includes(t.key) && sites[t.target]) return sites[t.target]
  return null
}

/* ── labels ── */
export interface LabelPoint extends Point {
  id: string
  code: string
  name: string
}
export interface PlacedLabel extends Rect {
  ids: string[]
  text: string
  count: number
  hidden?: boolean
}
export interface LabelOptions {
  radius?: number
  height?: number
  gap?: number
  measure?: (text: string) => number
  avoid?: Rect[]
  bounds?: Rect
}
/** Monospace estimate for tests; the page measures with the real font. */
export function approxWidth(text: string, size = 10.5): number {
  let w = 0
  for (const ch of text) w += /[　-鿿＀-￯]/.test(ch) ? size : size * 0.62
  return w
}
export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}
export function labelText(members: LabelPoint[]): string {
  const counts = new Map<string, number>()
  for (const m of members) if (m.code && m.code !== '--') counts.set(m.code, (counts.get(m.code) || 0) + 1)
  const codes = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a))
  const head = codes.length
    ? codes.slice(0, 4).join(' · ') + (codes.length > 4 ? ' +' + (codes.length - 4) : '')
    : members.length === 1
      ? members[0].name.slice(0, 14)
      : '··'
  return `${head} ${members.length}`
}
interface Group {
  members: LabelPoint[]
  x: number
  y: number
}
const groupOf = (members: LabelPoint[]): Group => ({
  members,
  x: members.reduce((a, m) => a + m.x, 0) / members.length,
  y: members.reduce((a, m) => a + m.y, 0) / members.length,
})
const gap2 = (a: Group, b: Group) => Math.hypot(a.x - b.x, a.y - b.y)

/* Merge dots closer than `radius` (screen px) into one label, then place each label
   on the first free side (right, below, left, above…) that stays inside the map and
   off every other label, the target label and the other dots. When a label finds no
   free spot its group joins the nearest group (within 4 × radius) and placement runs
   again, so crowded areas share one label instead of losing one. Only a label with
   no near neighbour can stay hidden; its dots still keep their hover card. */
export function clusterLabels(points: LabelPoint[], o: LabelOptions = {}): PlacedLabel[] {
  const radius = o.radius ?? 30
  let groups = points.map(p => groupOf([p]))
  for (;;) {
    let best: [number, number, number] | null = null
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const d = gap2(groups[i], groups[j])
        if (d < radius && (!best || d < best[2])) best = [i, j, d]
      }
    if (!best) break
    const [i, j] = best
    groups = groups
      .filter((_, k) => k !== i && k !== j)
      .concat(groupOf([...groups[i].members, ...groups[j].members]))
  }
  for (let round = 0; ; round++) {
    const placed = placeLabels(groups, points, o)
    const lost = placed.findIndex(l => l.hidden)
    if (lost < 0 || round > points.length) return placed.map(l => l.label)
    const g = placed[lost].group,
      near = groups.filter(x => x !== g).sort((a, b) => gap2(a, g) - gap2(b, g))[0]
    if (!near || gap2(near, g) > radius * 4) return placed.map(l => l.label)
    groups = groups.filter(x => x !== g && x !== near).concat(groupOf([...g.members, ...near.members]))
  }
}
function placeLabels(
  groups: Group[],
  points: LabelPoint[],
  o: LabelOptions,
): { group: Group; label: PlacedLabel; hidden: boolean }[] {
  const h = o.height ?? 14,
    gap = o.gap ?? 6,
    measure = o.measure ?? (t => approxWidth(t))
  const dots: Rect[] = points.map(p => ({ x: p.x - 4, y: p.y - 4, w: 8, h: 8 }))
  const taken: Rect[] = [...(o.avoid || [])]
  const inside = (r: Rect) =>
    !o.bounds ||
    (r.x >= o.bounds.x &&
      r.y >= o.bounds.y &&
      r.x + r.w <= o.bounds.x + o.bounds.w &&
      r.y + r.h <= o.bounds.y + o.bounds.h)
  return [...groups]
    .sort((a, b) => b.members.length - a.members.length || a.x - b.x)
    .map(g => ({ group: g, label: placeOne(g) }))
    .map(x => ({ ...x, hidden: !!x.label.hidden }))
  function placeOne(g: Group): PlacedLabel {
    const text = labelText(g.members),
      w = measure(text)
    const xs = g.members.map(m => m.x),
      ys = g.members.map(m => m.y)
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys),
      cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2
    const own = new Set(g.members.map(m => m.id))
    const spots: Point[] = [
      { x: x1 + gap, y: cy - h / 2 },
      { x: x1 + gap / 2, y: y1 + gap / 2 },
      { x: cx - w / 2, y: y1 + gap },
      { x: x0 - gap - w, y: cy - h / 2 },
      { x: cx - w / 2, y: y0 - gap - h },
      { x: x1 + gap / 2, y: y0 - gap / 2 - h },
      { x: x0 - gap / 2 - w, y: y1 + gap / 2 },
      { x: x0 - gap / 2 - w, y: y0 - gap / 2 - h },
    ]
    for (const scale of [1, 2.2])
      for (const s of spots) {
        const r = {
          x: s.x + (s.x >= x1 ? gap * (scale - 1) : s.x + w <= x0 ? -gap * (scale - 1) : 0),
          y: s.y + (s.y >= y1 ? gap * (scale - 1) : s.y + h <= y0 ? -gap * (scale - 1) : 0),
          w,
          h,
        }
        if (inside(r) && !taken.some(t => overlaps(r, t)) && !dots.some(t => overlaps(r, t))) {
          taken.push(r)
          return { ...r, ids: [...own], text, count: g.members.length }
        }
      }
    return { x: cx, y: cy, w: 0, h: 0, ids: [...own], text, count: g.members.length, hidden: true }
  }
}
