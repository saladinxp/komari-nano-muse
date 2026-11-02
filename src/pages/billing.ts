/* Ledger 「续费日历」: totals per currency, the next twelve months of renewals,
   monthly spend by group and the node table (cards on phones). The maths lives in
   ledger/model.ts; this module only renders static HTML / SVG. */
import { S, visible } from '../state'
import { bindTips, hideTip } from '../ui/tip'
import { $, esc, fDate, p2, store } from '../utils/format'
import {
  calendarDays,
  composition,
  ledgerRow,
  money,
  moneyParts,
  priceMoney,
  projectRenewals,
  renewalCalendar,
  sortRows,
  summarize,
  type LedgerRow,
  type LedgerSort,
  type LedgerSummary,
  type MonthBucket,
  type Money,
} from './ledger/model'

interface LedgerView {
  rows: LedgerRow[]
  summary: LedgerSummary
  calendar: MonthBucket[]
  currency: string | null
}
let view: LedgerView | null = null
let picked: string | null = store.get('billCur', null)
let drawnWidth = 0

const amounts = (m: Money) =>
  Object.keys(m)
    .sort((a, b) => m[b] - m[a] || a.localeCompare(b))
    .map(c => priceMoney(c, m[c]))
    .join(' · ')
const monthDay = (d: Date, now: Date) =>
  (d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '-' : '') +
  p2(d.getMonth() + 1) +
  '-' +
  p2(d.getDate())
const namesOf = (items: { name: string }[]) =>
  items.length ? items[0].name + (items.length > 1 ? ' +' + (items.length - 1) : '') : ''

/* ── totals ── */
function tiles(s: LedgerSummary, now: Date): string {
  const tile = (label: string, value: string, sub: string, more = '', flag = '') =>
    `<div class="tile card ledger-tile"><span>${label}</span><b class="num">${value}</b>${more ? `<i class="tile-more num">${more}</i>` : ''}<em>${sub}</em>${flag ? `<i class="tile-flag">${flag}</i>` : ''}</div>`
  const monthly = moneyParts(s.monthly),
    annual = moneyParts(s.annual, 0)
  const next = s.next
  const nextDays = next ? calendarDays(next.date, now) : 0
  const nextTotals: Money = {}
  next?.items.forEach(r => (nextTotals[r.currency] = (nextTotals[r.currency] || 0) + r.amount))
  const soonSub = [
    s.soon.nodes ? '合计 ' + esc(amounts(s.soon.totals)) : '未来 30 天没有续费',
    s.soon.unbilled ? `另有 ${s.soon.unbilled} 台未计费到期` : '',
  ].filter(Boolean)
  return (
    tile(
      '月均合计',
      esc(monthly[0] || '—'),
      s.billed
        ? `按周期折算 · ${s.billed} 台计费${s.expiredBilled ? ` · 含已过期 ${s.expiredBilled} 台` : ''}`
        : '没有可折算的计费节点',
      esc(monthly.slice(1).join(' · ')),
    ) +
    tile(
      '年度估算',
      esc(annual[0] || '—'),
      '月均 × 12 · 各币种分开，不换算',
      esc(annual.slice(1).join(' · ')),
    ) +
    tile(
      '下次续费',
      next ? monthDay(next.date, now) : '—',
      next
        ? `${nextDays <= 0 ? '今天' : nextDays + ' 天后'} · ${esc(namesOf(next.items))} · ${esc(amounts(nextTotals))}`
        : '没有可推算的续费',
    ) +
    tile(
      '30 天内续费',
      `${s.soon.nodes}<small>台</small>`,
      soonSub.join(' · '),
      '',
      s.expired.length
        ? `<span class="ledger-flag is-expired">已过期 ${s.expired.length} 台另计，不算在内</span>`
        : '',
    )
  )
}

/* ── renewal calendar: one series, one colour, two direct labels ── */
let ctx: CanvasRenderingContext2D | null = null
function textWidth(text: string, font: string): number {
  ctx ||= document.createElement('canvas').getContext('2d')
  if (!ctx) return text.length * 6.5
  ctx.font = font
  return ctx.measureText(text).width
}
function fit(text: string, max: number, font: string): string {
  if (textWidth(text, font) <= max) return text
  let t = text
  while (t.length > 1 && textWidth(t + '…', font) > max) t = t.slice(0, -1)
  return t + '…'
}
function drawCalendar(width: number) {
  if (!view) return
  const box = $('blCalendar'),
    cur = view.currency
  drawnWidth = width
  if (!cur || !view.calendar.some(b => b.totals[cur])) {
    box.innerHTML = `<p class="ledger-empty">${cur ? `未来 12 个月没有 ${esc(cur)} 续费` : '没有可推算的续费'}<span>需要价格、计费周期和到期日都已填写、且未过期的节点</span></p>`
    return
  }
  const months = width < 560 ? 6 : 12,
    buckets = view.calendar.slice(0, months),
    values = buckets.map(b => b.totals[cur] || 0)
  const top = 30,
    axis = 132,
    H = 186,
    slot = width / months,
    barW = Math.max(10, Math.min(28, slot * 0.42)),
    max = Math.max(...values)
  const nextIdx = values.findIndex(v => v > 0),
    highIdx = values.indexOf(max)
  const font = `10.5px ${getComputedStyle(document.documentElement).getPropertyValue('--fc') || 'sans-serif'}`
  const n = (v: number) => v.toFixed(1)
  let s = `<svg class="cal-svg" viewBox="0 0 ${n(width)} ${H}" width="${n(width)}" height="${H}" role="group" aria-label="未来 ${months} 个月续费金额（${esc(cur)}）"><line class="cal-axis" x1="0" x2="${n(width)}" y1="${axis + 0.5}" y2="${axis + 0.5}"/>`
  buckets.forEach((b, i) => {
    const v = values[i],
      cx = slot * (i + 0.5),
      h = max > 0 ? (v / max) * (axis - top) : 0,
      items = b.items.filter(r => r.currency === cur)
    const label = `${b.year} 年 ${b.month} 月 · ${v ? priceMoney(cur, v) : '无续费'}${items.length ? ' · ' + items.map(r => r.name).join('、') : ''}`
    s += `<g class="cal-slot" data-tip="cal" data-i="${i}" tabindex="0" role="img" aria-label="${esc(label)}"><rect class="cal-hit" x="${n(slot * i)}" y="0" width="${n(slot)}" height="${H}"/>`
    if (v > 0)
      s += `<rect class="cal-bar" x="${n(cx - barW / 2)}" y="${n(axis - h)}" width="${n(barW)}" height="${n(h)}"/>`
    if (v > 0 && (i === nextIdx || i === highIdx))
      s += `<text class="cal-value" x="${n(cx)}" y="${n(axis - h - 7)}" text-anchor="middle">${esc(priceMoney(cur, v))}</text>`
    s += `<text class="cal-month" x="${n(cx)}" y="${axis + 17}" text-anchor="middle">${b.month}月</text>`
    const who = namesOf(items)
    if (who)
      s += `<text class="cal-who" x="${n(cx)}" y="${axis + 32}" text-anchor="middle">${esc(fit(who, slot - 6, font))}</text>`
    if (i === 0 || b.month === 1)
      s += `<text class="cal-year" x="${n(cx)}" y="${axis + 47}" text-anchor="middle">${b.year}</text>`
    s += '</g>'
  })
  box.innerHTML = s + '</svg>'
}
function calendarTip(i: number): string {
  const b = view?.calendar[i],
    cur = view?.currency
  if (!b || !cur) return null
  const items = b.items.filter(r => r.currency === cur)
  const others: Money = {}
  b.items
    .filter(r => r.currency !== cur)
    .forEach(r => (others[r.currency] = (others[r.currency] || 0) + r.amount))
  const now = new Date()
  return (
    `<b>${b.year} 年 ${b.month} 月 · ${items.length ? esc(priceMoney(cur, b.totals[cur])) : '无续费'}</b>` +
    (items.length
      ? '<ul>' +
        items
          .map(
            r =>
              `<li><span>${esc(r.name)}${r.auto == null ? '' : r.auto ? ' · 自动续费' : ' · 手动'}</span><em>${monthDay(r.date, now)}</em><i>${esc(priceMoney(r.currency, r.amount))}</i></li>`,
          )
          .join('') +
        '</ul>'
      : '') +
    (Object.keys(others).length ? `<small>另有 ${esc(amounts(others))}（切换币种查看）</small>` : '')
  )
}

/* ── monthly spend by group (or region) ── */
function mix(rows: LedgerRow[], cur: string | null): string {
  if (!cur) {
    $('blMixSub').textContent = '按分组'
    return '<p class="ledger-empty">暂无计费节点<span>填写价格和计费周期后显示构成</span></p>'
  }
  const c = composition(rows, cur)
  $('blMixSub').textContent = `${c.by === 'group' ? '按分组' : '按地区（节点都没有分组）'} · ${cur}`
  if (!c.slices.length) return `<p class="ledger-empty">没有 ${esc(cur)} 计费节点</p>`
  const cls = (s, i) => (s.other ? 'mix-other' : 'mix-' + i)
  const tipOf = s =>
    `${s.label} · ${money(cur, s.amount)} · ${s.pct}% · ${s.members.slice(0, 6).join('、')}${s.members.length > 6 ? ' 等 ' + s.members.length + ' 台' : ''}`
  return (
    `<div class="mix-bar" role="list" aria-label="月均构成（${esc(cur)}）">${c.slices
      .map(
        (s, i) =>
          `<span class="mix-seg ${cls(s, i)}" role="listitem" tabindex="0" data-tip="mix" data-text="${esc(tipOf(s))}" aria-label="${esc(tipOf(s))}" style="flex-grow:${s.amount.toFixed(4)}"></span>`,
      )
      .join('')}</div>` +
    `<ul class="mix-legend">${c.slices
      .map(
        (s, i) =>
          `<li><i class="mix-sw ${cls(s, i)}"></i><span title="${esc(s.members.join('、'))}">${esc(s.label)}</span><b class="num">${esc(money(cur, s.amount))}</b><em class="num">${s.pct}%</em></li>`,
      )
      .join('')}</ul>`
  )
}

/* ── node table (CSS turns rows into cards on phones) ── */
function cyclePrice(r: LedgerRow): string {
  if (r.kind === 'free') return '<span class="ledger-free">免费</span>'
  if (r.kind === 'unpriced') return '<span class="ledger-muted">未定价</span>'
  return `${esc(r.cycle ? r.cycle.label : '周期未设')} · ${esc(priceMoney(r.currency, r.node.price))}`
}
function expiryCell(r: LedgerRow): string {
  if (!r.expiry) return '<span>长期</span><small>无到期日</small>'
  const d = r.days
  const note = d < 0 ? `已过期 ${-d} 天` : d === 0 ? '今天到期' : `剩 ${d} 天`
  const auto =
    r.auto == null || r.kind !== 'paid'
      ? ''
      : `<span class="ledger-auto${r.auto ? ' on' : ''}">${r.auto ? '自动续费' : '手动续费'}</span>`
  return `<span>${fDate(r.expiry)}</span><small class="is-${r.state}">${note}${auto}</small>`
}
function usedCell(r: LedgerRow): string {
  // Free nodes have no renewal, so no cycle to fill (Claude's beta.6 retest, suggestion 2).
  if (r.used == null || r.kind === 'free') return '<span class="ledger-muted">—</span>'
  const pct = Math.round(r.used * 100)
  return `<span class="ledger-used is-${r.state}"><i style="width:${pct}%"></i></span><small>${r.state === 'expired' ? '已过期' : `本周期已用 ${pct}%`}</small>`
}
function table(rows: LedgerRow[]): string {
  const head = ['节点', '周期 · 价格', '月均', '到期', '本周期', '每核月均']
  return `<table class="tbl ledger-tbl"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows
    .map(r => {
      const on = S.online.has(r.node.uuid),
        href = '/detail/' + encodeURIComponent(r.node.uuid)
      return `<tr class="${r.state === 'expired' ? 'is-expired' : r.state === 'soon' ? 'is-soon' : ''}" data-href="${href}"><td class="nm" data-l="节点"><span class="dot${on ? '' : ' off'}"></span><a href="${href}" data-nav>${esc(r.node.name)}</a><span class="ledger-code">${esc(r.code)}</span></td><td data-l="周期 · 价格">${cyclePrice(r)}</td><td data-l="月均">${r.monthly != null ? esc(money(r.currency, r.monthly)) : '<span class="ledger-muted">—</span>'}</td><td class="ledger-exp" data-l="到期">${expiryCell(r)}</td><td class="ledger-cycle" data-l="本周期">${usedCell(r)}</td><td data-l="每核月均">${r.perCore != null ? `${esc(money(r.currency, r.perCore))}<span class="ledger-unit"> / 核 · 月</span>` : '<span class="ledger-muted">—</span>'}</td></tr>`
    })
    .join('')}</tbody></table>`
}
function note(s: LedgerSummary, rows: LedgerRow[]): string {
  const parts = []
  if (s.expired.length)
    parts.push(
      `<span class="ledger-flag is-expired">已过期 ${s.expired.length} 台</span>：${s.expired
        .map(r => `${esc(r.node.name)}（${-r.days} 天）`)
        .join('、')} · 不推算以后的续费，到后台更新到期日后恢复`,
    )
  const counts = [
    s.free && `免费 ${s.free} 台`,
    rows.filter(r => !r.expiry).length && `长期 ${rows.filter(r => !r.expiry).length} 台`,
    s.unpriced && `未定价 ${s.unpriced} 台`,
    s.oneTime && `一次性 ${s.oneTime} 台`,
  ].filter(Boolean)
  if (counts.length) parts.push(counts.join(' · ') + ' · 不计入月均和续费日历')
  return parts.join('<br>')
}

function rBilling() {
  hideTip()
  document.querySelectorAll<HTMLElement>('#blSort button').forEach(b => {
    b.classList.toggle('on', b.dataset.s === S.bill)
    b.setAttribute('aria-pressed', String(b.dataset.s === S.bill))
  })
  const now = new Date(),
    rows = visible().map(n => ledgerRow(n, now)),
    renewals = projectRenewals(rows, now),
    summary = summarize(rows, renewals, now)
  const currency = summary.currencies.includes(picked) ? picked : summary.currencies[0] || null
  view = { rows, summary, calendar: renewalCalendar(renewals, now), currency }
  $('blTiles').innerHTML = tiles(summary, now)
  const pills = $('blCurrency')
  pills.hidden = summary.currencies.length < 2
  pills.innerHTML = summary.currencies
    .map(
      c =>
        `<button data-cur="${esc(c)}" class="${c === currency ? 'on' : ''}" aria-pressed="${c === currency}">${esc(c)}</button>`,
    )
    .join('')
  $('blCalSub').textContent = currency
    ? `未来 12 个月每月要续的金额（${currency}）· 标出下一笔和最高一笔，其余悬停查看`
    : '未来 12 个月每月要续的金额'
  drawCalendar($('blCalendar').clientWidth || 720)
  $('blMix').innerHTML = mix(rows, currency)
  const text = note(summary, rows)
  $('blNote').hidden = !text
  $('blNote').innerHTML = text
  $('blBody').innerHTML = rows.length
    ? table(sortRows(rows, S.bill as LedgerSort))
    : '<p class="ledger-empty">暂无节点</p>'
}

/* The detail page's spec row keeps its 2.0 wording ("$48 / 年"); beta.6 leaves that page alone. */
function billing(n) {
  if (!n.price) return { str: '', monthly: 0, cur: '', months: 0 }
  if (n.price === -1) return { str: '免费', monthly: 0, cur: '', months: 0, free: true }
  const cur = n.currency || '$',
    days = parseInt(n.billing_cycle) || 30
  let lab, months
  if (days <= 31) {
    lab = '月'
    months = 1
  } else if (days <= 93) {
    lab = '季'
    months = 3
  } else if (days <= 186) {
    lab = '半年'
    months = 6
  } else if (days <= 366) {
    lab = '年'
    months = 12
  } else {
    const y = Math.round(days / 365)
    lab = y + '年'
    months = y * 12
  }
  return { str: cur + n.price + ' / ' + lab, monthly: n.price / months, cur, months, days, lab }
}

/* Event wiring, called once from main after the views are mounted. */
function bindBilling() {
  $('blSort').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    S.bill = b.dataset.s
    store.set('billSort', S.bill)
    rBilling()
  })
  $('blCurrency').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    picked = b.dataset.cur
    store.set('billCur', picked)
    rBilling()
  })
  bindTips($('pg-billing'), el =>
    el.dataset.tip === 'cal'
      ? calendarTip(Number(el.dataset.i))
      : el.dataset.tip === 'mix'
        ? esc(el.dataset.text)
        : null,
  )
  // Redraw only the static SVG when the panel width changes; never refetch.
  new ResizeObserver(entries => {
    const w = Math.round(entries[0].contentRect.width)
    if (S.page === 'billing' && view && w > 0 && w !== Math.round(drawnWidth)) drawCalendar(w)
  }).observe($('blCalendar'))
}

export { bindBilling, billing, rBilling }
