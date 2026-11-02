import { needsAttention } from '../hero/console'
import { nav } from '../router'
import { echoCard, loadEcho, syncEchoGroup, updateEchoCaption, updateEchoLive, syncEchoTrends } from './echo'
import { S, thr, visible } from '../state'
import {
  $,
  daysLeft,
  esc,
  fB,
  fClock,
  fDate,
  fMs,
  fS,
  fUp,
  osShort,
  p2,
  pct,
  regionCode,
  store,
  validDate,
} from '../utils/format'
import { metrics } from '../utils/metrics'
import type { KomariNode } from '../types/komari'
import type { NodeView } from '../types/state'
import { bindCoreCrew, coreCrew, coreCrewEnabled, updateCoreControls, updateCoreCrew } from './crew'
import { usageBlock, usageOf, updateUsageBlocks } from '../utils/usage'
import { presetBindings, presetRows, syncEchoPresetControls } from './echo-presets'
import { loadNodeTelemetry, onTelemetryChange, throughputTrace } from './telemetry'

export const NODE_SORTS = [
  'default',
  'name',
  'cpu',
  'ram',
  'disk',
  'load',
  'speed',
  'traffic',
  'expiry',
] as const
type Sort = (typeof NODE_SORTS)[number]
let sort: Sort = NODE_SORTS.includes(store.get('node-sort', 'default'))
  ? store.get('node-sort', 'default')
  : 'default'
let sortedAt = 0
let currentLayout = ''
const lvl = (v, k) => (v >= thr(k) ? 'h' : v >= thr(k) * 0.75 ? 'w' : '')
const defaultOrder = (a: KomariNode, b: KomariNode) =>
  (a.weight || 0) - (b.weight || 0) || S.nodes.indexOf(a) - S.nodes.indexOf(b)

export function sortNodes(nodes: KomariNode[], by: Sort = sort): KomariNode[] {
  const value = (n: KomariNode): number | null => {
    if (by === 'expiry') return validDate(n.expired_at)?.getTime() ?? null
    if (by === 'traffic') return usageOf(n).total
    if (!S.lastSync || !S.online.has(n.uuid)) return null
    const m = metrics(n)
    if (by === 'load') return m.hasLoad ? m.load1 : null
    if (by === 'speed') return m.hasNetwork ? m.up + m.down : null
    const known = by === 'cpu' ? m.hasCpu : by === 'ram' ? m.hasMemory : m.hasDisk
    return known ? (m[by] ?? null) : null
  }
  return [...nodes].sort((a, b) => {
    if (by === 'default') return defaultOrder(a, b)
    if (by === 'name') return a.name.localeCompare(b.name, 'zh-Hans', { numeric: true }) || defaultOrder(a, b)
    const av = value(a),
      bv = value(b)
    if (av == null || bv == null) return av == null && bv == null ? defaultOrder(a, b) : av == null ? 1 : -1
    return (by === 'expiry' ? av - bv : bv - av) || defaultOrder(a, b)
  })
}
function filtered() {
  const q = S.q.toLowerCase()
  return sortNodes(
    visible().filter(
      n =>
        (S.status === 'all' ||
          (S.status === 'attention' && needsAttention(n)) ||
          (S.lastSync && (S.status === 'online' ? S.online.has(n.uuid) : !S.online.has(n.uuid)))) &&
        (S.group === 'ALL' || n.group === S.group) &&
        (!q ||
          [n.name, n.region, regionCode(n.region), n.os, n.tags].some(s =>
            (s || '').toLowerCase().includes(q),
          )),
    ),
  )
}
function rGroups() {
  const gs = [
    ...new Set(
      visible()
        .map(n => n.group)
        .filter(Boolean),
    ),
  ]
  if (S.group !== 'ALL' && !gs.includes(S.group)) S.group = 'ALL'
  const html = ['ALL', ...gs]
    .map(
      g =>
        `<button data-g="${esc(g)}" class="${g === S.group ? 'on' : ''}">${g === 'ALL' ? '全部' : esc(g)}</button>`,
    )
    .join('')
  if ($('groupTabs').innerHTML !== html) $('groupTabs').innerHTML = html
  $('groupTabs').style.display = gs.length ? '' : 'none'
}

/** The same loaded observations serve Array, Core, Echo and the home scene. */
function nodeProbes(uuid: string) {
  const tasks = S.echo.entries[uuid]?.tasks || []
  const ids = Object.values(presetBindings())
  return ids.length
    ? presetRows(tasks, uuid).map(row => row.task || { name: row.name, last: null, avg: null, loss: null })
    : tasks.slice(0, 1)
}
function probeText(t): string {
  if (!t?.last) return '等待采样'
  if (Date.now() - t.last.t > 300_000) return '旧样本'
  return t.last.timeout || t.last.loss === 1 ? '超时' : t.avg == null ? '—' : fMs(t.avg)
}
function probeSummary(n: KomariNode, full = false): string {
  const entry = S.echo.entries[n.uuid],
    tasks = nodeProbes(n.uuid)
  if (!tasks.length)
    return (
      '<span class="probe-empty">' +
      (entry?.error
        ? '拨测读取失败'
        : entry?.configured
          ? '拨测等待采样'
          : entry
            ? '未配置拨测'
            : '拨测等待读取') +
      '</span>'
    )
  if (!full) return tasks.map(t => esc(probeText(t))).join(' / ')
  return tasks
    .map(
      t =>
        `<span class="core-probe${t.last?.timeout || t.last?.loss === 1 ? ' bad' : ''}" title="${esc(t.name)} · 1H 应答均值 / 丢包"><i>${esc(t.name)}</i><b>${esc(probeText(t))}</b><em>${t.loss == null ? '—' : t.loss.toFixed(1) + '%'} </em></span>`,
    )
    .join('')
}
function expiry(n: KomariNode): string {
  const date = validDate(n.expired_at),
    dl = daysLeft(n.expired_at)
  return date
    ? `<span class="${dl <= 15 ? 'nc-exp' : ''}">${dl < 0 ? '已过期 ' : '到期 '}${fDate(date)}</span>`
    : ''
}
function price(n: KomariNode): string {
  if (n.price === -1) return '免费'
  if (!Number.isFinite(n.price) || n.price <= 0) return ''
  const days = Number(n.billing_cycle)
  return `${n.currency || '$'}${n.price}${days > 0 ? ' / ' + days + '天' : ''}`
}
function age(n: KomariNode): string {
  const t = +new Date(metrics(n).at || '')
  if (!Number.isFinite(t)) return '<span class="data-age stale">上报时间 —</span>'
  const old = Date.now() - t > 60_000 || !S.online.has(n.uuid)
  return `<span class="data-age${old ? ' stale' : ''}" title="${esc(new Date(t).toLocaleString())}">${old ? '旧数据 ' : '上报 '}${fClock(new Date(t))}</span>`
}
function resource(n: KomariNode, k: 'cpu' | 'ram' | 'disk', lab: string): string {
  const m = metrics(n),
    on =
      !!S.lastSync && S.online.has(n.uuid) && (k === 'cpu' ? m.hasCpu : k === 'ram' ? m.hasMemory : m.hasDisk)
  const capacity =
    k === 'cpu'
      ? n.cpu_cores
        ? n.cpu_cores + ' vCPU'
        : '核数 —'
      : (on ? fB(k === 'ram' ? m.memU : m.diskU).replace(' ', '\u00a0') : '—') +
        ' / ' +
        (k === 'ram' ? (m.memT ? fB(m.memT) : '—') : m.diskT ? fB(m.diskT) : '—').replace(' ', '\u00a0')
  return `<div class="resource"><span class="resource-label">${lab}</span><b data-v="${k}">${on ? Math.round(m[k]) + '<small>%</small>' : '—'}</b><div class="thin"><i data-k="${k}" class="${on ? lvl(m[k], k) : ''}" style="width:${on ? Math.max(0, Math.min(100, m[k])) : 0}%"></i></div><small class="resource-cap">${capacity}</small></div>`
}
function state(n: KomariNode): string {
  const m = metrics(n),
    on = S.online.has(n.uuid),
    alert = m.cpu >= thr('cpu') || m.ram >= thr('ram') || m.disk >= thr('disk')
  return `<span class="nc-status${on && alert ? ' warn' : ''}"><i class="dot${S.lastSync && !on ? ' off' : ''}"></i>${!S.lastSync ? '等待连接' : !on ? '离线' : alert ? '负载告警' : '在线'}</span><span>UP <span data-v="upt">${S.lastSync && on ? fUp(m.uptime) : '—'}</span></span>`
}
function coreReadings(n: KomariNode): string {
  const m = metrics(n),
    on = !!S.lastSync && S.online.has(n.uuid)
  const loads =
    on && m.hasLoad ? [m.load1, m.load5, m.load15].map(v => v.toFixed(2)).join(' / ') : '— / — / —'
  const loadWarn = on && m.hasLoad && n.cpu_cores && m.load1 > n.cpu_cores
  return `<div class="core-facts"><span>负载 1 / 5 / 15</span><b class="${loadWarn ? 'nc-exp' : ''}" title="按 ${n.cpu_cores || '未知'} 核理解负载">${loads}</b><span>TCP / UDP · 进程</span><b>${on && m.hasConnections ? m.tcp + ' / ' + m.udp : '— / —'} · ${on && m.hasProcess ? m.proc : '—'}</b>${m.swapT > 0 ? `<span>Swap</span><b>${on && m.hasSwap ? fB(m.swapU) : '—'} / ${fB(m.swapT)}${on && m.hasSwap ? ' · ' + pct(m.swapU, m.swapT).toFixed(0) + '%' : ''}</b>` : ''}</div>`
}
function net(n: KomariNode): string {
  const m = metrics(n),
    on = !!S.lastSync && S.online.has(n.uuid) && m.hasNetwork
  return `<span class="u"><em>↑ 上行</em><span data-v="up">${on ? fS(m.up) : '—'}</span></span><span class="d"><em>↓ 下行</em><span data-v="down">${on ? fS(m.down) : '—'}</span></span>`
}
function header(n: KomariNode): string {
  return `<div class="nc-h"><span class="flag">${esc(regionCode(n.region))}</span>${S.view === 'large' && coreCrewEnabled() ? coreCrew(n.uuid) : ''}<span class="nc-n" title="${esc(n.name)}">${esc(n.name)}</span><span class="nc-arrow" aria-hidden="true">↗</span></div>`
}
function arrayCard(n: KomariNode): string {
  const spec = [
    osShort(n.os),
    n.cpu_cores ? n.cpu_cores + ' vCPU' : '',
    n.mem_total ? fB(n.mem_total, 0) : '',
  ]
    .filter(Boolean)
    .join(' · ')
  return `${header(n)}<div class="nc-os" title="${esc(spec)}">${esc(spec) || '规格未提供'}</div><div class="nc-b" data-resources></div><div class="array-signal" data-array-signal></div><div class="nc-net" data-network></div>${usageBlock(n)}<div class="nc-foot" data-node-state></div><div class="array-expiry">${expiry(n)}</div>`
}
function coreQuota(n: KomariNode): string {
  const u = usageOf(n)
  if (!u.known) return '<div class="usage-line"><span>累计计数</span><b>等待上报</b></div>'
  if (!u.limit) return '<div class="usage-line"><span>累计 ' + fB(u.total) + '</span><b>未设配额</b></div>'
  return `<div class="usage-line"><span>配额 ${u.used == null ? '—' : fB(u.used)} / ${fB(u.limit, 0)}</span><b>${u.used == null ? '计量口径未知' : u.over ? '超出 ' + fB(u.over) : '剩余 ' + fB(u.remaining)}</b></div><div class="thin usage-bar"><i class="${u.percent >= 90 ? 'h' : u.percent >= 75 ? 'w' : ''}" style="width:${Math.max(0, Math.min(100, u.percent || 0))}%"></i></div>`
}
function coreCard(n: KomariNode): string {
  const spec = [
    osShort(n.os),
    n.cpu_name || (n.cpu_cores ? n.cpu_cores + ' vCPU' : ''),
    n.arch,
    n.virtualization,
    n.mem_total ? fB(n.mem_total, 0) : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const tags = (n.tags || '')
    .split(/[;,，；]/)
    .map(s => s.trim())
    .filter(Boolean)
  return `${header(n)}<div class="nc-os" title="${esc(spec)}">${esc(spec) || '规格未提供'}</div>${tags.length ? '<div class="core-tags" title="' + esc(tags.join(' · ')) + '">' + tags.map(t => '<span>' + esc(t) + '</span>').join('') + '</div>' : ''}<div class="nc-b" data-resources></div><div data-core-facts></div><div class="core-network"><div class="nc-net" data-network></div><div class="net-history" data-net-history></div></div><div class="core-transfer" data-core-transfer></div><div class="core-quota" data-core-quota title="按节点累计计数对照配额，不等于本月账单"></div><div class="core-probes" data-core-pings></div><div class="nc-foot" data-node-state></div><div class="core-meta"><span>${expiry(n)}${validDate(n.expired_at) && price(n) ? ' · ' : ''}${esc(price(n))}</span><span data-node-age></span></div>`
}
function card(n: KomariNode, i: number): string {
  if (S.view === 'list') return echoCard(n, i)
  return `<a class="nc" href="/detail/${encodeURIComponent(n.uuid)}" data-nav data-u="${esc(n.uuid)}">${S.view === 'large' ? coreCard(n) : arrayCard(n)}</a>`
}
function patchHTML(el: Element, selector: string, html: string) {
  const target = el.querySelector(selector)
  if (target && target.innerHTML !== html) target.innerHTML = html
}
function updateCard(el: HTMLElement, n: KomariNode) {
  const on = S.online.has(n.uuid),
    m = metrics(n),
    u = usageOf(n)
  el.classList.toggle('off', !!S.lastSync && !on)
  el.classList.toggle(
    'alert',
    !!S.lastSync && on && (m.cpu >= thr('cpu') || m.ram >= thr('ram') || m.disk >= thr('disk')),
  )
  patchHTML(
    el,
    '[data-resources]',
    resource(n, 'cpu', 'CPU') + resource(n, 'ram', 'MEMORY') + resource(n, 'disk', 'DISK'),
  )
  patchHTML(el, '[data-network]', net(n))
  patchHTML(el, '[data-node-state]', state(n))
  patchHTML(
    el,
    '[data-array-signal]',
    `<span>负载 ${on && m.hasLoad ? m.load1.toFixed(2) : '—'}</span><span data-node-ping>${probeSummary(n)}</span>`,
  )
  patchHTML(el, '[data-core-facts]', coreReadings(n))
  patchHTML(el, '[data-core-quota]', coreQuota(n))
  patchHTML(
    el,
    '[data-core-transfer]',
    `<span>累计 ↑ ${u.up == null ? '—' : fB(u.up)}</span><span>↓ ${u.down == null ? '—' : fB(u.down)}</span>`,
  )
  patchHTML(el, '[data-node-age]', age(n))
  patchHTML(el, '[data-core-pings]', probeSummary(n, true))
}
export function updateNodeSignals() {
  if (S.page !== 'dashboard' || S.view === 'list') return
  document.querySelectorAll<HTMLElement>('#nodes .nc').forEach(el => {
    const n = S.nodes.find(n => n.uuid === el.dataset.u)
    if (!n) return
    patchHTML(el, '[data-core-pings]', probeSummary(n, true))
    patchHTML(el, '[data-node-ping]', probeSummary(n))
  })
}
function updateTraces() {
  if (S.page !== 'dashboard' || S.view !== 'large') return
  document.querySelectorAll<HTMLElement>('[data-net-history]').forEach(el => {
    const html = throughputTrace(el.closest<HTMLElement>('[data-u]').dataset.u)
    if (el.innerHTML !== html) el.innerHTML = html
  })
}
function reconcile(forceSort = false) {
  const list = filtered(),
    layout = S.view + '|' + coreCrewEnabled()
  let grid = $('nodes').querySelector<HTMLElement>('.grid')
  if (!grid || layout !== currentLayout) {
    $('nodes').innerHTML = `<div class="grid nodes-${S.view}"></div>`
    grid = $('nodes').firstElementChild as HTMLElement
    currentLayout = layout
    forceSort = true
  }
  const wanted = new Set(list.map(n => n.uuid)),
    existing = new Map([...grid.children].map(e => [(e as HTMLElement).dataset.u, e as HTMLElement]))
  existing.forEach((el, id) => {
    if (!wanted.has(id)) el.remove()
  })
  const move =
    forceSort || Date.now() - sortedAt >= 10_000 || sort === 'default' || sort === 'name' || sort === 'expiry'
  list.forEach((n, i) => {
    let el = existing.get(n.uuid)
    const signature = JSON.stringify(n)
    if (!el || el.dataset.spec !== signature) {
      const template = document.createElement('template')
      template.innerHTML = card(n, i)
      const next = template.content.firstElementChild as HTMLElement
      next.dataset.spec = signature
      if (el) el.replaceWith(next)
      el = next
    }
    if (!el.parentElement || (move && grid.children[i] !== el))
      grid.insertBefore(el, grid.children[i] || null)
    if (S.view !== 'list') updateCard(el, n)
  })
  if (move) sortedAt = Date.now()
  if (!list.length)
    $('nodes').innerHTML =
      '<div class="empty">' +
      (!S._loaded ? '载入中…' : !S.nodes.length ? '暂无节点' : '没有匹配的节点') +
      '</div>'
  $('nCount').textContent = p2(list.length)
  updateUsageBlocks()
  updateCoreCrew()
}
function rNodes() {
  rGroups()
  $<HTMLSelectElement>('nodeSort').value = sort
  $('viewCaption').textContent = {
    medium: 'STAR ARRAY / 核心资源巡航',
    large: 'STELLAR CORE / 完整遥测',
    list: 'SIGNAL ECHO / 最近1小时拨测',
  }[S.view]
  $('echoControls').hidden = S.view !== 'list'
  syncEchoPresetControls()
  updateCoreControls()
  document.querySelectorAll<HTMLElement>('#viewSeg button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === S.view)
    b.setAttribute('aria-pressed', String(b.dataset.v === S.view))
  })
  reconcile(true)
  syncEchoTrends()
  updateTraces()
  if (S.view === 'list') {
    syncEchoGroup()
    updateEchoLive()
    updateEchoCaption()
  }
  if (S._loaded) {
    void loadEcho()
    void loadNodeTelemetry()
  }
}
function uNodes() {
  reconcile()
  if (S.view === 'list') updateEchoLive()
}
function bindNodeList() {
  bindCoreCrew(rNodes)
  onTelemetryChange(updateTraces)
  $('nodeSort').addEventListener('change', e => {
    sort = (e.target as HTMLSelectElement).value as Sort
    store.set('node-sort', sort)
    rNodes()
  })
  $('groupTabs').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    S.group = b.dataset.g
    store.set('group', S.group)
    rNodes()
  })
  $('viewSeg').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b || !['large', 'medium', 'list'].includes(b.dataset.v)) return
    S.view = b.dataset.v as NodeView
    store.set('view', S.view)
    rNodes()
  })
  $('search').addEventListener('input', e => {
    S.q = (e.target as HTMLInputElement).value.trim()
    rNodes()
  })
  $('statusFilter').addEventListener('change', e => {
    S.status = (e.target as HTMLSelectElement).value
    rNodes()
  })
  $('exploreBtn').addEventListener('click', () =>
    $('nodes').scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    }),
  )
  document.addEventListener('click', e => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-href]')
    if (row) nav(row.dataset.href)
  })
  $('watchAll').addEventListener('click', () => $('attentionBtn').click())
  $('attentionBtn').addEventListener('click', () => {
    S.status = 'attention'
    S.group = 'ALL'
    S.q = ''
    $<HTMLInputElement>('search').value = ''
    $<HTMLSelectElement>('statusFilter').value = 'attention'
    rNodes()
    $('nodes').scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}
export { bindNodeList, filtered, lvl, rNodes, uNodes }
