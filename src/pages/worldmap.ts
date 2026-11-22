/* Star Map 「回声星图」: totals, an auto-zoomed land map with one arc per node to the
   Echo default domestic targets (coloured by the same last-hour rules as the Echo
   trend), and region cards. Static SVG, drawn on open, on node status changes, on
   new Echo data and on resize. Echo data is the overview's shared 60 s batch.
   2.1.1: the visitor can zoom (buttons, Ctrl / pinch wheel, double click, two fingers)
   and drag the map; the zoom is kept across redraws until 复位. */
import { DOMESTIC_PRESET_KEYS, ECHO_SITES, type EchoSite } from '../data/echo-sites'
import { WMAP_LAND } from '../data/geo'
import { regionName } from '../data/places'
import { loadEcho, onEchoData } from '../nodes/echo'
import { ECHO_PRESETS, configuredPresets, presetBindings, presetRows } from '../nodes/echo-presets'
import { S, visible } from '../state'
import type { KomariNode } from '../types/komari'
import { bindTips, hideTip } from '../ui/tip'
import { $, esc, fMs, fS, regionCode } from '../utils/format'
import { metrics } from '../utils/metrics'
import {
  answered,
  arcApex,
  arcPath,
  arcTarget,
  clusterLabels,
  fitView,
  locate,
  median,
  nodeLink,
  panBy,
  project,
  toScreen,
  worstLink,
  zoomAt,
  zoomedView,
  zoomRange,
  type LinkQuality,
  type MapZoom,
  type Point,
  type Rect,
} from './map/model'

interface Line {
  name: string
  avg: number | null
  loss: number | null
  message?: string
}
interface MapNode {
  n: KomariNode
  on: boolean
  code: string
  base: Point | null
  link: LinkQuality
  lines: Line[]
  latencies: number[]
}
interface MapModel {
  nodes: MapNode[]
  /** Default domestic lines are bound to tasks. */
  enabled: boolean
  /** Every bound line is still a beta.3 binding waiting for the administrator. */
  waiting: boolean
  site: EchoSite | null
  arcs: boolean
}
let model: MapModel | null = null
let drawnWidth = 0
/* Visitor zoom (null = auto) and the auto view of the last drawing, for the handlers. */
let zoom: MapZoom | null = null
let autoView: Rect | null = null

const QUALITY_TEXT: Record<LinkQuality, string> = {
  stable: '稳定',
  unstable: '波动 / 部分丢包',
  lost: '丢包',
  missing: '无数据',
  offline: '节点离线',
  none: '未连线',
}

function build(): MapModel {
  const now = Date.now(),
    bindings = presetBindings(),
    enabled = DOMESTIC_PRESET_KEYS.some(k => bindings[k]),
    site = enabled ? arcTarget(configuredPresets(), ECHO_SITES, DOMESTIC_PRESET_KEYS) : null,
    used = new Map<string, number>(),
    setting = (S.ts && S.ts.node_coords) || ''
  let waitingRows = 0,
    boundRows = 0
  const nodes = visible().map(n => {
    const on = S.online.has(n.uuid),
      at = locate(n, setting, used)
    let lines: Line[] = [],
      link: LinkQuality = 'none',
      latencies: number[] = []
    if (enabled) {
      const rows = presetRows(S.echo.entries[n.uuid]?.tasks || [], n.uuid).filter((_, i) =>
        (DOMESTIC_PRESET_KEYS as readonly string[]).includes(ECHO_PRESETS[i].key),
      )
      for (const r of rows)
        if (r.message !== '尚未启用') {
          boundRows++
          if (r.message === '待管理员更新目标') waitingRows++
        }
      lines = rows.map(r => ({
        name: r.name,
        avg: r.task?.avg ?? null,
        loss: r.task?.loss ?? null,
        message: r.task ? undefined : r.message,
      }))
      link = site ? nodeLink(rows, on, now) : 'none'
      latencies = rows.flatMap(r => answered(r.task))
    }
    return {
      n,
      on,
      code: regionCode(n.region),
      base: at ? project(at[0], at[1]) : null,
      link,
      lines,
      latencies,
    }
  })
  return {
    nodes,
    enabled,
    waiting: boundRows > 0 && waitingRows === boundRows,
    site,
    arcs: !!site && nodes.some(m => m.link !== 'none'),
  }
}

/* ── totals ── */
function tiles(m: MapModel): string {
  const tile = (label: string, value: string, sub: string) =>
    `<div class="tile card"><span>${label}</span><b class="num">${value}</b><em>${sub}</em></div>`
  const total = m.nodes.length,
    online = m.nodes.filter(x => x.on),
    offline = m.nodes.filter(x => !x.on),
    regions = new Set(m.nodes.map(x => x.code)).size,
    placed = m.nodes.filter(x => x.base).length,
    med = median(online.flatMap(x => x.latencies))
  const target = m.site ? `到${m.site.name}三网 · 中位` : '到三网目标 · 中位'
  const echoSub = !m.enabled
    ? '未启用默认四线'
    : m.waiting
      ? '默认三网待管理员更新目标'
      : med == null
        ? S.echo.pending
          ? '正在读取拨测…'
          : '在线节点暂无三网样本'
        : `回声默认线路 · 最近1小时 · ${online.filter(x => x.latencies.length).length} 台`
  return (
    tile(
      '地区',
      String(regions),
      `REGIONS · ${placed} 个已定位${placed < total ? ` · ${total - placed} 个无坐标` : ''}`,
    ) +
    tile('在线', `${online.length}<small>/ ${total}</small>`, 'ONLINE') +
    tile(target, med == null ? '—' : `${Math.round(med)}<small>ms</small>`, echoSub) +
    tile(
      '离线',
      String(offline.length),
      offline.length ? esc(offline.map(x => x.n.name).join(' · ')) : S.lastSync ? '全部在线' : '等待节点快照',
    )
  )
}

/* ── map ── */
let ctx: CanvasRenderingContext2D | null = null
const LABEL_FONT = '600 10.5px "JetBrains Mono", ui-monospace, monospace'
const TARGET_FONT = '500 11px "Noto Sans SC", "Sora", sans-serif'
function measure(text: string, font = LABEL_FONT): number {
  ctx ||= document.createElement('canvas').getContext('2d')
  if (!ctx) return text.length * 11
  ctx.font = font
  return Math.ceil(ctx.measureText(text).width) + 2
}
/* The stage keeps its zoom buttons and hint; only the map inside is redrawn, so a
   focused button stays focused while it is pressed again. */
const ZOOM_UI =
  '<div class="sm-zoom" role="group" aria-label="星图缩放"><button type="button" data-zoom="in" title="放大" aria-label="放大">+</button><button type="button" data-zoom="out" title="缩小" aria-label="缩小">−</button><button type="button" data-zoom="reset" title="回到自动缩放" aria-label="回到自动缩放">复位</button></div><p class="sm-hint" aria-hidden="true">按住 Ctrl 再滚动来缩放 · 拖动可平移</p><div class="sm-map"></div>'
function stage(): HTMLElement {
  const box = $('mapC')
  if (!box.querySelector('.sm-map')) box.innerHTML = ZOOM_UI
  return box.querySelector('.sm-map')
}
function zoomButtons(view: Rect | null) {
  const box = $('mapC'),
    btn = (k: string) => box.querySelector<HTMLButtonElement>(`[data-zoom="${k}"]`)
  box.classList.toggle('no-zoom', !view)
  box.classList.toggle('zoomed', !!view && view.w < autoView.w - 0.01)
  if (!view) return
  const [lo, hi] = zoomRange(autoView),
    z = autoView.w / view.w
  btn('in').disabled = z >= hi - 1e-6
  btn('out').disabled = z <= lo + 1e-6
  btn('reset').disabled = !zoom
}
function drawMap(width: number) {
  if (!model) return
  drawnWidth = width
  const box = stage(),
    placed = model.nodes.filter(x => x.base),
    site = model.site,
    target = site ? project(site.at[0], site.at[1]) : null
  if (!placed.length) {
    autoView = null
    zoomButtons(null)
    box.innerHTML =
      '<p class="sm-empty">还没有可定位的节点<span>在节点名称里写城市、填写地区，或在主题设置的节点坐标里指定</span></p>'
    return
  }
  const linked = model.arcs ? placed.filter(x => x.link !== 'none') : []
  autoView = fitView([
    ...placed.map(x => x.base),
    ...(linked.length && target ? [target, ...linked.map(x => arcApex(x.base, target))] : []),
  ])
  const view = zoomedView(autoView, zoom)
  zoomButtons(view)
  const height = (width * view.h) / view.w,
    k = width / view.w,
    phone = width < 560,
    n = (v: number) => v.toFixed(1)
  const scr = (p: Point) => toScreen(p, view, width)
  let s = `<svg class="sm-svg" viewBox="0 0 ${n(width)} ${n(height)}" width="${n(width)}" height="${n(height)}" role="group" aria-label="节点星图：${placed.length} 个节点${linked.length ? '，弧线连到' + esc(site.name) + '三网目标' : ''}"><defs><linearGradient id="smLand" gradientUnits="userSpaceOnUse" x1="${n(view.x)}" y1="${n(view.y)}" x2="${n(view.x + view.w)}" y2="${n(view.y + view.h)}"><stop offset="0" class="sm-land-a"/><stop offset="0.55" class="sm-land-b"/><stop offset="1" class="sm-land-c"/></linearGradient></defs><g transform="translate(${n(-view.x * k)} ${n(-view.y * k)}) scale(${k.toFixed(4)})"><path class="sm-land" d="${WMAP_LAND}" fill="url(#smLand)"/></g>`
  const t = target && linked.length ? scr(target) : null
  if (t) {
    const order: LinkQuality[] = ['offline', 'missing', 'stable', 'unstable', 'lost']
    for (const q of order)
      for (const x of linked.filter(x => x.link === q))
        s += `<path class="sm-arc q-${q}" data-u="${esc(x.n.uuid)}" d="${arcPath(scr(x.base), t)}"/>`
  }
  for (const x of placed) {
    const p = scr(x.base),
      label = `${x.n.name} · ${x.on ? '在线' : '离线'}${x.link !== 'none' ? ' · 三网' + QUALITY_TEXT[x.link] : ''}`
    s += `<a class="sm-node${x.on ? '' : ' off'}" href="/detail/${encodeURIComponent(x.n.uuid)}" data-nav data-metric="ping" data-tip="node" data-u="${esc(x.n.uuid)}" aria-label="${esc(label)}">${x.on ? `<circle class="sm-halo" cx="${n(p.x)}" cy="${n(p.y)}" r="8"/>` : ''}<circle class="sm-hit" cx="${n(p.x)}" cy="${n(p.y)}" r="10"/><circle class="sm-dot" cx="${n(p.x)}" cy="${n(p.y)}" r="3.6"/></a>`
  }
  let avoid: Rect[] = []
  if (t) {
    s += `<path class="sm-target" d="M${n(t.x)} ${n(t.y - 6)}L${n(t.x + 6)} ${n(t.y)}L${n(t.x)} ${n(t.y + 6)}L${n(t.x - 6)} ${n(t.y)}Z"/>`
    if (!phone) {
      const text = `${site.name} · 三网目标`,
        w = measure(text, TARGET_FONT)
      const left = t.x - 10 - w >= 2
      const r = { x: left ? t.x - 10 - w : t.x + 10, y: t.y - 7, w, h: 14 }
      avoid = [r, { x: t.x - 7, y: t.y - 7, w: 14, h: 14 }]
      s += `<text class="sm-target-label" x="${n(left ? t.x - 10 : t.x + 10)}" y="${n(t.y + 3.5)}" text-anchor="${left ? 'end' : 'start'}">${esc(text)}</text>`
    }
  }
  if (!phone) {
    const labels = clusterLabels(
      placed
        .map(x => ({ id: x.n.uuid, code: x.code, name: x.n.name, ...scr(x.base) }))
        .filter(l => l.x >= 0 && l.x <= width && l.y >= 0 && l.y <= height),
      {
        avoid,
        bounds: { x: 2, y: 2, w: width - 4, h: height - 4 },
        measure,
        radius: Math.max(30, Math.min(48, width / 40)),
      },
    )
    for (const l of labels) {
      if (l.hidden) continue
      const cut = l.text.lastIndexOf(' ')
      s += `<text class="sm-label" x="${n(l.x)}" y="${n(l.y + l.h - 3.5)}">${esc(l.text.slice(0, cut))} <tspan class="sm-label-n">${l.count}</tspan></text>`
    }
  }
  box.innerHTML = s + '</svg>'
}
function keyAndCaption(m: MapModel) {
  const area = '自动缩放到有节点的区域，可放大缩小、拖动'
  $('mapCaption').textContent = m.arcs
    ? `${area} · 每个节点一条弧线连到${m.site.name}三网目标，颜色是最近 1 小时回声`
    : !m.enabled
      ? `${area} · 未启用回声默认四线，只显示节点位置（管理员可在总览「回声」里启用）`
      : m.waiting
        ? `${area} · 默认三网待管理员在回声里更新目标，只显示节点位置`
        : !m.site
          ? `${area} · 三网目标是自定义地址、位置未登记，只显示节点位置`
          : `${area} · 节点还没有分配到默认三网任务，只显示节点位置`
  const line = (q: string, text: string) => `<li><i class="sm-key-line q-${q}"></i>${text}</li>`
  const dot = (cls: string, text: string) => `<li><i class="sm-key-dot ${cls}"></i>${text}</li>`
  $('mapKey').innerHTML = m.arcs
    ? line('stable', '稳定') +
      line('unstable', '波动 / 部分丢包') +
      line('lost', '丢包') +
      line('offline', '离线 / 无数据')
    : dot('', '在线') + dot('off', '离线')
}
function nodeTip(uuid: string): string {
  const x = model?.nodes.find(v => v.n.uuid === uuid)
  if (!x) return null
  const m = metrics(x.n),
    live = x.on && S.lastSync
  const lines = x.lines.length
    ? '<ul>' +
      x.lines
        .map(
          l =>
            `<li><span>${esc(l.name)}</span>${l.message ? `<em>${esc(l.message)}</em><i></i>` : `<em>${l.avg == null ? '—' : esc(fMs(l.avg))}</em><i>${l.loss == null ? '—' : (l.loss === 100 ? '100' : l.loss.toFixed(1)) + '% 丢包'}</i>`}</li>`,
        )
        .join('') +
      '</ul>'
    : `<small>${model.enabled ? '没有默认三网数据' : '未启用默认四线'}</small>`
  return (
    `<b>${esc(x.n.name)}<span class="sm-tip-state${x.on ? '' : ' off'}">${x.on ? '在线' : '离线'}</span></b>` +
    (x.link !== 'none'
      ? `<small class="sm-tip-q q-${x.link}">三网 · ${QUALITY_TEXT[x.link]} · 最近1小时</small>`
      : '') +
    lines +
    `<small class="sm-tip-live">CPU ${live && m.hasCpu ? m.cpu.toFixed(1) + '%' : '—'} · ↑ ${live && m.hasNetwork ? fS(m.up) : '—'} · ↓ ${live && m.hasNetwork ? fS(m.down) : '—'}</small><small>点击查看详情</small>`
  )
}

/* ── region cards ── */
function regionCards(m: MapModel): string {
  const by = new Map<string, MapNode[]>()
  for (const x of m.nodes) by.set(x.code, [...(by.get(x.code) || []), x])
  return [...by.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([code, list]) => {
      const on = list.filter(x => x.on),
        med = median(on.flatMap(x => x.latencies)),
        q = m.arcs ? worstLink(on.map(x => x.link).filter(v => v !== 'none')) : 'none',
        down = on.reduce((a, x) => a + (metrics(x.n).hasNetwork ? metrics(x.n).down : 0), 0)
      const name = regionName(code)
      return `<article class="card sm-region"><div class="sm-region-head"><span class="ledger-code">${esc(code)}</span><b>${esc(name)}</b><em>${on.length} / ${list.length} 在线</em></div><ul>${list
        .map(
          x =>
            `<li><a href="/detail/${encodeURIComponent(x.n.uuid)}" data-nav><span class="dot${x.on ? '' : ' off'}"></span>${esc(x.n.name)}</a></li>`,
        )
        .join(
          '',
        )}</ul><div class="sm-region-foot"><span class="sm-q q-${q}" title="${esc(QUALITY_TEXT[q])}"></span><span>三网中位 <b class="num">${m.enabled ? (med == null ? '—' : esc(fMs(med))) : '未启用'}</b></span><span class="sm-down num">↓ ${on.length && S.lastSync ? esc(fS(down)) : '—'}</span></div></article>`
    })
    .join('')
}

function rMap() {
  hideTip()
  model = build()
  $('mapTiles').innerHTML = tiles(model)
  keyAndCaption(model)
  drawMap($('mapC').clientWidth || 960)
  $('mapList').innerHTML = model.nodes.length ? regionCards(model) : '<p class="sm-empty">暂无节点</p>'
  const placed = model.nodes.filter(x => x.base).length
  $('mpSub').textContent =
    `节点分布 · ${new Set(model.nodes.map(x => x.code)).size} 个地区 · ${placed} 个已定位`
  // Shares the overview's 60 s cache: within a minute of the overview this asks nothing.
  if (model.enabled) void loadEcho()
}

/* ── zoom and drag ── */
let frame = 0
function redraw() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (S.page === 'worldmap' && model) drawMap($('mapC').clientWidth || drawnWidth)
  })
}
function setZoom(next: MapZoom | null) {
  zoom = next
  hideTip()
  redraw()
}
function local(e: { clientX: number; clientY: number }): Point {
  const r = $('mapC').querySelector('.sm-map').getBoundingClientRect()
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}
function centre(): Point {
  const r = $('mapC').querySelector('.sm-map').getBoundingClientRect()
  return { x: r.width / 2, y: r.height / 2 }
}
let hintTimer = 0
function showHint() {
  const box = $('mapC')
  box.classList.add('hint')
  clearTimeout(hintTimer)
  hintTimer = window.setTimeout(() => box.classList.remove('hint'), 1400)
}
function bindZoom() {
  const box = $('mapC')
  box.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-zoom]')
    if (!b || !autoView) return
    const k = b.dataset.zoom
    setZoom(k === 'reset' ? null : zoomAt(autoView, zoom, k === 'in' ? 1.6 : 1 / 1.6, centre(), drawnWidth))
  })
  /* A plain wheel keeps scrolling the page; Ctrl / ⌘ + wheel and trackpad pinch
     (which the browser sends as a Ctrl wheel) zoom at the pointer. */
  box.addEventListener(
    'wheel',
    e => {
      if (!autoView || !(e.target as HTMLElement).closest('.sm-map')) return
      if (!e.ctrlKey && !e.metaKey) return showHint()
      e.preventDefault()
      const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      setZoom(
        zoomAt(autoView, zoom, Math.exp(-Math.max(-60, Math.min(60, step)) / 150), local(e), drawnWidth),
      )
    },
    { passive: false },
  )
  box.addEventListener('dblclick', e => {
    const t = e.target as HTMLElement
    if (!autoView || !t.closest('.sm-map') || t.closest('.sm-node')) return
    e.preventDefault()
    setZoom(zoomAt(autoView, zoom, e.shiftKey ? 1 / 2 : 2, local(e), drawnWidth))
  })
  /* Drag: mouse any time, one finger only when zoomed in (so the page still scrolls);
     two fingers pinch. A drag of more than 4 px swallows the click that follows. */
  const points = new Map<number, Point>()
  let last: Point | null = null,
    spread = 0,
    moved = false
  const mid = () => {
    const [a, b] = [...points.values()]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }
  const gap = () => {
    const [a, b] = [...points.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
  box.addEventListener('pointerdown', e => {
    if (!autoView || !(e.target as HTMLElement).closest('.sm-map')) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (!points.size) moved = false
    if (e.pointerType === 'touch' && !box.classList.contains('zoomed') && points.size === 0) {
      points.set(e.pointerId, local(e))
      last = null
      return
    }
    points.set(e.pointerId, local(e))
    if (points.size === 1) last = local(e)
    else if (points.size === 2) {
      last = mid()
      spread = gap()
    }
  })
  box.addEventListener('pointermove', e => {
    if (!points.has(e.pointerId) || !autoView) return
    points.set(e.pointerId, local(e))
    if (points.size === 2) {
      const m = mid(),
        g = gap()
      let next = zoom
      if (spread > 0 && g > 0) next = zoomAt(autoView, next, g / spread, m, drawnWidth)
      if (last) next = panBy(autoView, next, m.x - last.x, m.y - last.y, drawnWidth)
      last = m
      spread = g
      moved = true
      setZoom(next)
      return
    }
    if (!last) return
    const p = local(e),
      dx = p.x - last.x,
      dy = p.y - last.y
    if (!moved && Math.hypot(dx, dy) < 4) return
    if (!moved) box.setPointerCapture?.(e.pointerId)
    moved = true
    last = p
    box.classList.add('dragging')
    setZoom(panBy(autoView, zoom, dx, dy, drawnWidth))
  })
  const end = (e: PointerEvent) => {
    if (!points.delete(e.pointerId)) return
    if (points.size === 1) {
      last = [...points.values()][0]
      spread = 0
    } else if (!points.size) {
      last = null
      box.classList.remove('dragging')
    }
  }
  box.addEventListener('pointerup', end)
  box.addEventListener('pointercancel', end)
  box.addEventListener(
    'click',
    e => {
      if (!moved) return
      moved = false
      if ((e.target as HTMLElement).closest('[data-zoom]')) return
      e.preventDefault()
      e.stopPropagation()
    },
    true,
  )
}

/* Event wiring, called once from main after the views are mounted. */
function bindMap() {
  bindZoom()
  bindTips($('pg-worldmap'), el => (el.dataset.tip === 'node' ? nodeTip(el.dataset.u) : null))
  onEchoData(() => {
    if (S.page === 'worldmap') rMap()
  })
  new ResizeObserver(entries => {
    const w = Math.round(entries[0].contentRect.width)
    if (S.page === 'worldmap' && model && w > 0 && w !== Math.round(drawnWidth)) drawMap(w)
  }).observe($('mapC'))
}

export { bindMap, rMap }
