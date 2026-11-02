import { rSpark } from '../hero/halo'
import { css, esc, p2 } from '../utils/format'
import { monotonePath, smoothPoints, type Pt } from './smooth'

/* ══ chart ══ */
/** A chart host keeps its config, draw function and resize observer on the element. */
type ChartHost = HTMLElement & { _cfg?: any; _draw?: (hx?: number | null) => void; _ro?: ResizeObserver }
const charts = new Set<ChartHost>()
function chart(host: ChartHost, cfg) {
  host.innerHTML = '<canvas></canvas><div class="tip" hidden></div>'
  host._cfg = cfg
  charts.add(host)
  const cv = host.firstChild as HTMLCanvasElement,
    tip = host.lastChild as HTMLElement
  const draw = (hx: number | null = null) => {
    // An invisible tooltip can still widen the document after a viewport resize.
    tip.hidden = true
    if (!host.isConnected) {
      charts.delete(host)
      return
    }
    const c = host._cfg,
      dpr = window.devicePixelRatio || 1,
      W = host.clientWidth,
      H = host.clientHeight
    if (!W || !H) return
    cv.width = W * dpr
    cv.height = H * dpr
    const g = cv.getContext('2d')
    g.scale(dpr, dpr)
    const L = 46,
      R = 10,
      T = 10,
      B = 22,
      pw = W - L - R,
      ph = H - T - B
    let t0 = Infinity,
      t1 = -Infinity,
      vm = 0
    c.series.forEach(s =>
      s.pts.forEach(p => {
        if (p[0] < t0) t0 = p[0]
        if (p[0] > t1) t1 = p[0]
        if (p[1] != null && p[1] > vm) vm = p[1]
      }),
    )
    g.font = '10px "JetBrains Mono",monospace'
    if (!isFinite(t0) || t1 <= t0) {
      g.fillStyle = css('ink4')
      g.textAlign = 'center'
      g.fillText('NO DATA · 暂无数据', W / 2, H / 2)
      return
    }
    let ym = c.max != null ? c.max : vm * 1.15 || 1
    if (c.max == null) {
      const mag = Math.pow(10, Math.floor(Math.log10(ym)))
      ym = (Math.ceil((ym / mag) * 2) / 2) * mag
    }
    const X = t => L + ((t - t0) / (t1 - t0)) * pw,
      Y = v => T + ph - (v / ym) * ph
    g.strokeStyle = css('line')
    g.lineWidth = 1
    g.fillStyle = css('ink4')
    g.textAlign = 'right'
    g.textBaseline = 'middle'
    for (let i = 0; i <= 4; i++) {
      const v = (ym * i) / 4,
        y = Math.round(Y(v)) + 0.5
      g.setLineDash(i ? [2, 4] : [])
      g.beginPath()
      g.moveTo(L, y)
      g.lineTo(W - R, y)
      g.stroke()
      g.fillText(c.fmt(v, true), L - 8, y)
    }
    g.setLineDash([])
    g.textAlign = 'center'
    g.textBaseline = 'top'
    const long = t1 - t0 > 36 * 3600e3
    const labelWidth = g.measureText(long ? '00/00 00h' : '00:00').width,
      ticks = Math.max(1, Math.min(4, Math.floor(pw / (labelWidth * 2 + 12))))
    for (let i = 0; i <= ticks; i++) {
      const t = t0 + ((t1 - t0) * i) / ticks,
        d = new Date(t)
      g.textAlign = i === 0 ? 'left' : i === ticks ? 'right' : 'center'
      g.fillText(
        long
          ? p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + ' ' + p2(d.getHours()) + 'h'
          : p2(d.getHours()) + ':' + p2(d.getMinutes()),
        X(t),
        H - B + 8,
      )
    }
    c.series.forEach(s => {
      const col = css(s.color)
      const segs = []
      let cur = []
      s.pts.forEach(p => {
        if (p[1] == null) {
          if (cur.length) segs.push(cur)
          cur = []
        } else cur.push(p)
      })
      if (cur.length) segs.push(cur)
      /* cfg.smooth (latency): about one real sample per 3 px, drawn as a monotone curve.
         Otherwise the original straight segments through every sample. */
      const screen = (sg): Pt[] => {
        const points = c.smooth
          ? smoothPoints(sg, Math.max(3, (X(sg[sg.length - 1][0]) - X(sg[0][0])) / 3))
          : sg
        return points.map(p => [X(p[0]), Y(Math.min(p[1], ym))])
      }
      const trace = (pts: Pt[], move: boolean) => {
        if (c.smooth) monotonePath(g, pts, move)
        else pts.forEach((p, i) => (i || !move ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])))
      }
      if (s.fill !== false) {
        const gr = g.createLinearGradient(0, T, 0, T + ph)
        gr.addColorStop(0, col + '26')
        gr.addColorStop(1, col + '00')
        g.fillStyle = gr
        segs.forEach(sg => {
          g.beginPath()
          g.moveTo(X(sg[0][0]), Y(0))
          trace(screen(sg), false)
          g.lineTo(X(sg[sg.length - 1][0]), Y(0))
          g.closePath()
          g.fill()
        })
      }
      g.strokeStyle = col
      g.lineWidth = 1.3
      g.lineJoin = 'round'
      segs.forEach(sg => {
        g.beginPath()
        trace(screen(sg), true)
        if (sg.length === 1) g.arc(X(sg[0][0]), Y(sg[0][1]), 1.5, 0, 7)
        g.stroke()
      })
    })
    if (hx != null && hx >= L && hx <= W - R) {
      const t = t0 + ((hx - L) / pw) * (t1 - t0)
      let rows = '',
        ax = null
      c.series.forEach(s => {
        const a = s.pts
        if (!a.length) return
        let lo = 0,
          hi = a.length - 1
        while (lo < hi) {
          const m = (lo + hi) >> 1
          a[m][0] < t ? (lo = m + 1) : (hi = m)
        }
        if (lo > 0 && t - a[lo - 1][0] < a[lo][0] - t) lo--
        const p = a[lo]
        if (ax == null) ax = p[0]
        if (p[1] != null) {
          g.beginPath()
          g.arc(X(p[0]), Y(Math.min(p[1], ym)), 3, 0, 7)
          g.fillStyle = css(s.color)
          g.fill()
        }
        rows += `<div><i style="background:${css(s.color)}"></i>${esc(s.name)}  ${p[1] == null ? '--' : c.fmt(p[1])}</div>`
      })
      if (ax != null) {
        const x = Math.round(X(ax)) + 0.5
        g.strokeStyle = css('ink3')
        g.setLineDash([2, 3])
        g.beginPath()
        g.moveTo(x, T)
        g.lineTo(x, T + ph)
        g.stroke()
        g.setLineDash([])
        const d = new Date(ax)
        tip.innerHTML =
          `<div class="t">${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}</div>` +
          rows
        tip.style.opacity = '1'
        tip.hidden = false
        const tw = tip.offsetWidth
        tip.style.left = Math.max(0, Math.min(W - tw, x + 12 + tw > W ? x - 12 - tw : x + 12)) + 'px'
        tip.style.top = T + 'px'
      }
    } else tip.style.opacity = '0'
  }
  host._draw = draw
  host.onpointermove = e => {
    const r = host.getBoundingClientRect()
    draw(e.clientX - r.left)
  }
  host.onpointerleave = () => draw(null)
  if (!host._ro) {
    host._ro = new ResizeObserver(() => host._draw && host._draw())
    host._ro.observe(host)
  }
  draw()
}
const redrawAll = () => {
  charts.forEach(h => h._draw && h._draw())
  rSpark()
}

export { chart, redrawAll }
