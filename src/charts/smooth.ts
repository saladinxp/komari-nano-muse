/* Smoother latency lines without inventing or hiding data (user, 2026-11-02: 「延迟线波浪很怪，
   得改改平滑点」).
   1. thin(): when samples are denser than the screen can show (~1 per 3 px), keep a subset
      with Largest-Triangle-Three-Buckets. It keeps real samples only, never averages, and
      tends to keep each bucket's extreme, so a spike stays a spike.
   2. monotonePath(): a monotone cubic through the kept points (the d3 curveMonotoneX rule):
      it passes every kept sample and never overshoots its neighbours, so the curve cannot
      draw a latency lower or higher than the samples around it.
   0. calm(): before both, small jitter is evened out. A sample within max(5 ms, 10 %) of
      its local median is replaced by the mean of its in-band neighbours; a sample outside
      that band (a real spike or dip) is kept exactly, and never bleeds into its neighbours.
   Hover readings, AVG / MAX / LOSS keep using the raw samples. */
export type Pt = [number, number]

export function calm(values: number[], win = 7, tolAbs = 5, tolRel = 0.1): number[] {
  const half = Math.floor(win / 2)
  return values.map((v, i) => {
    const near = values.slice(Math.max(0, i - half), i + half + 1)
    const sorted = [...near].sort((a, b) => a - b),
      m = sorted[Math.floor(sorted.length / 2)],
      tol = Math.max(tolAbs, Math.abs(m) * tolRel)
    if (Math.abs(v - m) > tol) return v
    const band = near.filter(x => Math.abs(x - m) <= tol)
    return band.reduce((a, b) => a + b, 0) / band.length
  })
}

export function thin(data: Pt[], keep: number): Pt[] {
  const n = data.length
  keep = Math.floor(keep)
  if (keep >= n || keep < 3) return data
  const out: Pt[] = [data[0]]
  const every = (n - 2) / (keep - 2)
  let a = 0
  for (let i = 0; i < keep - 2; i++) {
    // average of the next bucket, the third corner of the triangle
    const ns = Math.floor((i + 1) * every) + 1,
      ne = Math.min(Math.floor((i + 2) * every) + 1, n)
    let ax = 0,
      ay = 0
    for (let j = ns; j < ne; j++) {
      ax += data[j][0]
      ay += data[j][1]
    }
    const len = Math.max(1, ne - ns)
    ax /= len
    ay /= len
    const bs = Math.floor(i * every) + 1,
      be = Math.min(Math.floor((i + 1) * every) + 1, n - 1)
    let best = -1,
      pick = bs
    for (let j = bs; j < be; j++) {
      const area = Math.abs(
        (data[a][0] - ax) * (data[j][1] - data[a][1]) - (data[a][0] - data[j][0]) * (ay - data[a][1]),
      )
      if (area > best) {
        best = area
        pick = j
      }
    }
    out.push(data[pick])
    a = pick
  }
  out.push(data[n - 1])
  return out
}

const median = (vs: number[]) => {
  const s = [...vs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Calm jitter and thin quiet portions, always keeping clear outliers and level changes.
    LTTB alone can drop a smaller spike beside a larger one in the same bucket, so these are
    always drawn exactly: a sample more than twice the calm band from its local median, the
    samples on either side of it (so the spike stays narrow), and both edges of a level
    change (median of the three samples before vs the three after). Comparing adjacent raw
    samples instead would protect ordinary 3–10 ms jitter on real lines and bring the waves
    back. The pixel budget is soft for these points only. */
export function smoothPoints(data: Pt[], keep: number, win = 7, tolAbs = 5, tolRel = 0.1): Pt[] {
  const raw = data.map(p => p[1]),
    values = calm(raw, win, tolAbs, tolRel),
    half = Math.floor(win / 2),
    band = (m: number) => 2 * Math.max(tolAbs, Math.abs(m) * tolRel),
    protectedPoints = new Set<number>(),
    add = (i: number) => i >= 0 && i < raw.length && protectedPoints.add(i)
  raw.forEach((v, i) => {
    const m = median(raw.slice(Math.max(0, i - half), i + half + 1))
    if (Math.abs(v - m) > band(m)) [i - 1, i, i + 1].forEach(add)
    if (!i) return
    const before = median(raw.slice(Math.max(0, i - 3), i)),
      after = median(raw.slice(i, i + 3))
    if (
      Math.abs(after - before) > band(Math.min(Math.abs(before), Math.abs(after))) &&
      Math.abs(v - raw[i - 1]) > band(Math.min(Math.abs(v), Math.abs(raw[i - 1]))) / 2
    )
      [i - 1, i].forEach(add)
  })
  const points: Pt[] = data.map((p, i) => [p[0], protectedPoints.has(i) ? p[1] : values[i]]),
    kept = new Set(thin(points, keep))
  protectedPoints.forEach(i => kept.add(points[i]))
  return points.filter(p => kept.has(p))
}

const sign = (v: number) => (v < 0 ? -1 : 1)
/** Tangent at the middle of three points (d3's slope3). */
function slope3(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): number {
  const h0 = x1 - x0,
    h1 = x2 - x1,
    s0 = (y1 - y0) / h0,
    s1 = (y2 - y1) / h1,
    p = (s0 * h1 + s1 * h0) / (h0 + h1)
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
}
/** Cubic segments [x0, y0, c1x, c1y, c2x, c2y, x1, y1] through screen points (x increasing). */
export function monotoneSegments(pts: Pt[]): number[][] {
  const p = pts.filter((q, i) => i === 0 || q[0] > pts[i - 1][0])
  const n = p.length
  if (n < 2) return []
  if (n === 2) return [[p[0][0], p[0][1], p[0][0], p[0][1], p[1][0], p[1][1], p[1][0], p[1][1]]]
  const t = new Array<number>(n)
  for (let i = 1; i < n - 1; i++)
    t[i] = slope3(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1], p[i + 1][0], p[i + 1][1])
  const end = (h: number, s: number, ti: number) => (h ? (3 * s - ti) / 2 : ti)
  t[0] = end(p[1][0] - p[0][0], (p[1][1] - p[0][1]) / (p[1][0] - p[0][0]), t[1])
  t[n - 1] = end(
    p[n - 1][0] - p[n - 2][0],
    (p[n - 1][1] - p[n - 2][1]) / (p[n - 1][0] - p[n - 2][0]),
    t[n - 2],
  )
  const out: number[][] = []
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = p[i],
      [x1, y1] = p[i + 1],
      d = (x1 - x0) / 3
    out.push([x0, y0, x0 + d, y0 + d * t[i], x1 - d, y1 - d * t[i + 1], x1, y1])
  }
  return out
}
/** Trace a monotone curve on a canvas path; the caller strokes or fills it. */
export function monotonePath(g: CanvasRenderingContext2D, pts: Pt[], move = true) {
  const segs = monotoneSegments(pts)
  if (!segs.length) {
    if (pts.length) move ? g.moveTo(pts[0][0], pts[0][1]) : g.lineTo(pts[0][0], pts[0][1])
    return
  }
  move ? g.moveTo(segs[0][0], segs[0][1]) : g.lineTo(segs[0][0], segs[0][1])
  for (const s of segs) g.bezierCurveTo(s[2], s[3], s[4], s[5], s[6], s[7])
}
