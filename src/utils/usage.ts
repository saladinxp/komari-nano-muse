import type { KomariNode } from '../types/komari'
import { S } from '../state'
import { metrics, trafficUsed } from './metrics'
import { esc, fB } from './format'

const MODES: Record<string, string> = {
  sum: '双向合计',
  up: '上传计量',
  down: '下载计量',
  max: '上下行较大值',
  min: '上下行较小值',
}
export function usageOf(n: KomariNode) {
  const m = metrics(n),
    raw = S.live[n.uuid]
  const known =
    !!raw && (raw._hasTraffic ?? [raw.total_up, raw.total_down].every(v => Number.isFinite(v) && v >= 0))
  const mode = (n.traffic_limit_type || 'max').toLowerCase()
  const supported = Object.prototype.hasOwnProperty.call(MODES, mode)
  const used = known && supported ? trafficUsed(n, m) : null
  const limit =
    Number.isFinite(Number(n.traffic_limit)) && Number(n.traffic_limit) > 0 ? Number(n.traffic_limit) : null
  return {
    known,
    up: known ? m.tu : null,
    down: known ? m.td : null,
    total: known ? m.tu + m.td : null,
    used,
    limit,
    remaining: used != null && limit != null ? Math.max(0, limit - used) : null,
    over: used != null && limit != null ? Math.max(0, used - limit) : 0,
    percent: used != null && limit != null ? (used / limit) * 100 : null,
    basis: MODES[mode] || '未知计量方式',
    at: m.at,
    stale: !S.online.has(n.uuid),
  }
}
export function usageContent(n: KomariNode): string {
  const u = usageOf(n)
  const suffix = u.stale && u.known ? ' · 上次上报' : ''
  if (!u.known) return '<div class="usage-line"><span>累计流量</span><b>等待上报</b></div>'
  if (!u.limit)
    return `<div class="usage-line"><span>累计流量</span><b>${fB(u.total)}</b></div><div class="usage-note">↑ ${fB(u.up)} · ↓ ${fB(u.down)} · 未设配额${suffix}</div>`
  return `<div class="usage-line"><span>配额已用</span><b>${u.used == null ? '—' : fB(u.used)} <small>/ ${fB(u.limit, 0)}</small></b></div><div class="thin usage-bar"><i class="${u.percent != null && u.percent >= 90 ? 'h' : u.percent != null && u.percent >= 75 ? 'w' : ''}" style="width:${Math.max(0, Math.min(100, u.percent || 0))}%"></i></div><div class="usage-note">${u.used == null ? '缺少可用的计量口径' : u.over ? '超出 ' + fB(u.over) : '剩余 ' + fB(u.remaining)} · ${esc(u.basis)}${suffix}</div>`
}
export const usageBlock = (n: KomariNode): string =>
  `<div class="node-usage" data-node-usage="${esc(n.uuid)}" title="按节点最近上报的累计计数对照配置配额；不等同于服务商本月账单。">${usageContent(n)}</div>`
export function updateUsageBlocks() {
  document.querySelectorAll<HTMLElement>('[data-node-usage]').forEach(el => {
    const n = S.nodes.find(n => n.uuid === el.dataset.nodeUsage)
    if (!n) return
    const html = usageContent(n)
    if (el.innerHTML !== html) el.innerHTML = html
  })
}
export function detailTraffic(n: KomariNode): string {
  const u = usageOf(n)
  const v = (label: string, value: number | null) =>
    `<div><span>${label}</span><b>${value == null ? '—' : fB(value)}</b></div>`
  return `<div class="traffic-heading"><h2>流量与配额</h2><span>${u.stale && u.known ? '上次上报的累计计数' : '节点累计计数'} · ${esc(u.basis)}</span></div><div class="traffic-values">${v('累计上传', u.up)}${v('累计下载', u.down)}${v('累计双向', u.total)}${v('配置配额', u.limit)}${v(u.over ? '已超出配额' : '距配置配额剩余', u.over || u.remaining)}</div>${usageBlock(n)}<p class="usage-note">未设配额表示后台未填写额度。此处按累计计数展示，不自动推算服务商月度重置或账单。</p>`
}
