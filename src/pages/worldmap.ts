/* Star Map 「回声星图」: totals, an auto-zoomed land map with one arc per node to the
   Echo default domestic targets (coloured by the same last-hour rules as the Echo
   trend), and region cards. Static SVG, drawn on open, on node status changes, on
   new Echo data and on resize. Echo data is the overview's shared 60 s batch. */
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
  project,
  toScreen,
  worstLink,
  type LinkQuality,
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
function drawMap(width: number) {
  if (!model) return
  drawnWidth = width
  const box = $('mapC'),
    placed = model.nodes.filter(x => x.base),
    site = model.site,
    target = site ? project(site.at[0], site.at[1]) : null
  if (!placed.length) {
    box.innerHTML =
      '<p class="sm-empty">还没有可定位的节点<span>在节点名称里写城市、填写地区，或在主题设置的节点坐标里指定</span></p>'
    return
  }
  const linked = model.arcs ? placed.filter(x => x.link !== 'none') : []
  const view = fitView([
    ...placed.map(x => x.base),
    ...(linked.length && target ? [target, ...linked.map(x => arcApex(x.base, target))] : []),
  ])
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
      placed.map(x => ({ id: x.n.uuid, code: x.code, name: x.n.name, ...scr(x.base) })),
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
  const area = '自动缩放到有节点的区域'
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

/* Event wiring, called once from main after the views are mounted. */
function bindMap() {
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
