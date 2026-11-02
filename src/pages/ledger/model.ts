/* Ledger maths, kept free of DOM so qa/test-ledger-beta6.mjs can check it.
   Only real Komari fields are read: price (-1 = free), billing_cycle (days),
   currency (Komari default '$'), expired_at, cpu_cores, group, region.
   There are no exchange rates anywhere: every total is kept per currency. */
import { regionName } from '../../data/places'
import { regionCode, validDate } from '../../utils/format'

export interface LedgerNode {
  uuid: string
  name: string
  price?: number
  billing_cycle?: number | string
  currency?: string
  expired_at?: string
  /** Komari's 自动续费 flag; guests receive it. Absent on servers that predate it. */
  auto_renewal?: boolean
  cpu_cores?: number
  group?: string
  region?: string
}

/** Amount per currency code / symbol, never mixed. */
export type Money = Record<string, number>

export interface Cycle {
  days: number
  /** Calendar months for Komari's standard cycles; null means plain days. */
  months: number | null
  label: string
  /** Komari's 一次性 (billing_cycle = -1): paid once, never renews. */
  oneTime?: boolean
}

/* The same bands Komari's own auto-renewal uses (utils/renewal/renewal.go):
   inside a band the expiry moves by calendar months / years, otherwise by days. */
const BANDS: { min: number; max: number; months: number; label: string }[] = [
  { min: 27, max: 32, months: 1, label: '月付' },
  { min: 87, max: 95, months: 3, label: '季付' },
  { min: 175, max: 185, months: 6, label: '半年付' },
  { min: 360, max: 370, months: 12, label: '年付' },
  { min: 720, max: 750, months: 24, label: '两年付' },
  { min: 1080, max: 1150, months: 36, label: '三年付' },
  { min: 1800, max: 1850, months: 60, label: '五年付' },
]
const AVG_MONTH_DAYS = 365.25 / 12
const DAY = 86_400_000

export function cycleOf(raw: unknown): Cycle | null {
  const days = Number(raw)
  if (days === -1) return { days: -1, months: null, label: '一次性', oneTime: true }
  if (!Number.isFinite(days) || days <= 0) return null
  const band = BANDS.find(b => days >= b.min && days <= b.max)
  if (band) return { days, months: band.months, label: band.label }
  const whole = Math.round(days)
  return { days: whole, months: null, label: `每 ${whole} 天` }
}

export function currencyOf(n: LedgerNode): string {
  const c = String(n.currency ?? '').trim()
  if (!c) return '$'
  return /^[a-z]+$/i.test(c) ? c.toUpperCase() : c
}

export type PriceKind = 'paid' | 'free' | 'unpriced'
export function priceKind(n: LedgerNode): PriceKind {
  if (n.price === -1) return 'free'
  return typeof n.price === 'number' && Number.isFinite(n.price) && n.price > 0 ? 'paid' : 'unpriced'
}

/** Monthly equivalent of one cycle's price; null when it cannot be spread over months. */
export function monthlyOf(n: LedgerNode): number | null {
  if (priceKind(n) !== 'paid') return null
  const c = cycleOf(n.billing_cycle)
  if (!c || c.oneTime) return null
  return c.months ? n.price / c.months : (n.price * AVG_MONTH_DAYS) / c.days
}

/** Move a date by whole cycles the way Komari's AddDate does (Jan 31 + 1 month = Mar 3). */
export function addCycle(d: Date, c: Cycle, times = 1): Date {
  const out = new Date(d)
  if (c.months) out.setMonth(out.getMonth() + times * c.months)
  else out.setDate(out.getDate() + times * c.days)
  return out
}

/** Calendar-day distance in the viewer's time zone (Komari compares system dates too). */
export function calendarDays(target: Date, now: Date): number {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY
  return day(target) - day(now)
}

export function priceText(v: number): string {
  return String(Number(v.toFixed(2)))
}
/* Komari's default currency is the symbol '$'. Letter codes get a space (`USD 70.00`),
   symbols sit against the number (`$70.00`). Never converted, never guessed (¥ stays ¥). */
const isCode = (currency: string) => /^[A-Za-z]{2,}$/.test(currency)
export function withCurrency(currency: string, amount: string): string {
  return isCode(currency) ? `${currency} ${amount}` : currency + amount
}
/** An average or total, fixed decimals: `USD 70.00`, `$70.00`. */
export function money(currency: string, v: number, digits = 2): string {
  return withCurrency(currency, v.toFixed(digits))
}
/** A price as entered, trailing zeros dropped: `USD 48`, `¥15`, `€4.5`. */
export function priceMoney(currency: string, v: number): string {
  return withCurrency(currency, priceText(v))
}
/** Currencies of a Money map, largest first (ties by name, so the order is stable). */
export function currencyOrder(m: Money): string[] {
  return Object.keys(m).sort((a, b) => m[b] - m[a] || a.localeCompare(b))
}
export function moneyParts(m: Money, digits = 2): string[] {
  return currencyOrder(m).map(c => money(c, m[c], digits))
}
function add(m: Money, currency: string, v: number) {
  m[currency] = (m[currency] || 0) + v
}

export type RowState = 'expired' | 'soon' | 'ok' | 'none'
export interface LedgerRow {
  node: LedgerNode
  kind: PriceKind
  currency: string
  cycle: Cycle | null
  monthly: number | null
  perCore: number | null
  expiry: Date | null
  /** Calendar days until expiry; negative once expired, null for long-term. */
  days: number | null
  state: RowState
  /** Share of the current cycle already used, 0..1; null without a cycle or expiry. */
  used: number | null
  code: string
  /** true / false from Komari's auto_renewal; null when the server does not send it. */
  auto: boolean | null
}

export function ledgerRow(n: LedgerNode, now: Date): LedgerRow {
  const kind = priceKind(n),
    cycle = cycleOf(n.billing_cycle),
    monthly = monthlyOf(n),
    expiry = validDate(n.expired_at),
    days = expiry ? calendarDays(expiry, now) : null
  const cores = Number(n.cpu_cores)
  let used: number | null = null
  if (expiry && cycle && !cycle.oneTime) {
    if (days < 0) used = 1
    else {
      const start = addCycle(expiry, cycle, -1)
      used = Math.max(0, Math.min(1, (+now - +start) / (+expiry - +start)))
    }
  }
  return {
    node: n,
    kind,
    currency: currencyOf(n),
    cycle,
    monthly,
    perCore: monthly != null && cores > 0 ? monthly / cores : null,
    expiry,
    days,
    state: days == null ? 'none' : days < 0 ? 'expired' : days <= 30 ? 'soon' : 'ok',
    used,
    code: regionCode(n.region),
    auto: typeof n.auto_renewal === 'boolean' ? n.auto_renewal : null,
  }
}

export interface Renewal {
  uuid: string
  name: string
  date: Date
  amount: number
  currency: string
  auto: boolean | null
}

/** End (exclusive) of the calendar window: the first day of the month `months` ahead. */
export function windowEnd(now: Date, months = 12): Date {
  return new Date(now.getFullYear(), now.getMonth() + months, 1)
}

/* Each paid node's current cycle ends at expired_at, when one price is due; later
   renewals follow every cycle. Expired, long-term, free, unpriced and one-time
   nodes have no future renewals to project. */
export function projectRenewals(rows: LedgerRow[], now: Date, end = windowEnd(now)): Renewal[] {
  const out: Renewal[] = []
  for (const r of rows) {
    if (r.kind !== 'paid' || !r.cycle || r.cycle.oneTime || !r.expiry || r.days < 0) continue
    let due = r.expiry
    for (let i = 0; due < end && i < 400; i++) {
      out.push({
        uuid: r.node.uuid,
        name: r.node.name,
        date: due,
        amount: r.node.price,
        currency: r.currency,
        auto: r.auto,
      })
      due = addCycle(due, r.cycle)
    }
  }
  return out.sort((a, b) => +a.date - +b.date || a.name.localeCompare(b.name))
}

export interface MonthBucket {
  year: number
  /** 1–12 */
  month: number
  start: Date
  items: Renewal[]
  totals: Money
}
export function renewalCalendar(renewals: Renewal[], now: Date, months = 12): MonthBucket[] {
  return Array.from({ length: months }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() + i, 1),
      end = new Date(now.getFullYear(), now.getMonth() + i + 1, 1),
      items = renewals.filter(r => r.date >= start && r.date < end),
      totals: Money = {}
    items.forEach(r => add(totals, r.currency, r.amount))
    return { year: start.getFullYear(), month: start.getMonth() + 1, start, items, totals }
  })
}

export interface LedgerSummary {
  monthly: Money
  annual: Money
  /** Nodes whose price spreads into the monthly total (expired ones included, see below). */
  billed: number
  expiredBilled: number
  free: number
  unpriced: number
  oneTime: number
  expired: LedgerRow[]
  next: { date: Date; items: Renewal[] } | null
  /** Renewals due in the next 30 days (today included), never already expired nodes. */
  soon: { nodes: number; totals: Money; unbilled: number }
  /** Every currency seen, largest monthly first; the first one is the default view. */
  currencies: string[]
}

export function summarize(rows: LedgerRow[], renewals: Renewal[], now: Date): LedgerSummary {
  const monthly: Money = {}
  let billed = 0,
    expiredBilled = 0
  for (const r of rows)
    if (r.monthly != null) {
      add(monthly, r.currency, r.monthly)
      billed++
      if (r.state === 'expired') expiredBilled++
    }
  const annual: Money = Object.fromEntries(Object.entries(monthly).map(([c, v]) => [c, v * 12]))
  const first = renewals[0]
  const next = first
    ? { date: first.date, items: renewals.filter(r => calendarDays(r.date, first.date) === 0) }
    : null
  const due = renewals.filter(r => {
    const d = calendarDays(r.date, now)
    return d >= 0 && d <= 30
  })
  const soonTotals: Money = {}
  due.forEach(r => add(soonTotals, r.currency, r.amount))
  const dueIds = new Set(due.map(r => r.uuid))
  const seen: Money = { ...monthly }
  for (const r of renewals) if (!(r.currency in seen)) seen[r.currency] = 0
  for (const r of rows) if (r.kind === 'paid' && !(r.currency in seen)) seen[r.currency] = 0
  return {
    monthly,
    annual,
    billed,
    expiredBilled,
    free: rows.filter(r => r.kind === 'free').length,
    unpriced: rows.filter(r => r.kind === 'unpriced').length,
    oneTime: rows.filter(r => r.kind === 'paid' && r.cycle?.oneTime).length,
    expired: rows.filter(r => r.state === 'expired'),
    next,
    soon: {
      nodes: dueIds.size,
      totals: soonTotals,
      unbilled: rows.filter(r => r.state === 'soon' && !dueIds.has(r.node.uuid)).length,
    },
    currencies: currencyOrder(seen),
  }
}

export interface Slice {
  key: string
  label: string
  amount: number
  /** Whole percent; the slices always add up to 100. */
  pct: number
  members: string[]
  other?: boolean
}
export interface Composition {
  by: 'group' | 'region'
  currency: string
  total: number
  slices: Slice[]
}

/** Largest-remainder rounding, so the labels never add up to 99 or 101. */
export function wholePercents(values: number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0)
  if (!(total > 0)) return values.map(() => 0)
  const raw = values.map(v => (v / total) * 100),
    out = raw.map(Math.floor)
  let left = 100 - out.reduce((a, b) => a + b, 0)
  raw
    .map((v, i) => ({ i, r: v - Math.floor(v) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .forEach(({ i }) => {
      if (left > 0) {
        out[i]++
        left--
      }
    })
  return out
}

/* Monthly spend of one currency by Komari group; by region when no visible node
   has a group. At most `max` named slices, the rest folded into one grey 其他. */
export function composition(rows: LedgerRow[], currency: string, max = 3): Composition {
  const by = rows.some(r => (r.node.group || '').trim()) ? 'group' : 'region'
  const cats = new Map<string, { label: string; amount: number; members: string[] }>()
  for (const r of rows) {
    if (r.monthly == null || r.currency !== currency) continue
    const key = by === 'group' ? (r.node.group || '').trim() || '未分组' : r.code
    const label = by === 'group' ? key : regionName(key)
    const c = cats.get(key) || { label, amount: 0, members: [] }
    c.amount += r.monthly
    c.members.push(r.node.name)
    cats.set(key, c)
  }
  const sorted = [...cats.entries()]
    .map(([key, c]) => ({ key, ...c }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label))
  let parts: Omit<Slice, 'pct'>[] = sorted
  if (sorted.length > max) {
    const rest = sorted.slice(max)
    parts = [
      ...sorted.slice(0, max),
      {
        key: '__other',
        label:
          rest.length === 1
            ? `其他 · ${rest[0].label}`
            : `其他 ${rest.length} ${by === 'group' ? '组' : '个地区'}`,
        amount: rest.reduce((a, c) => a + c.amount, 0),
        members: rest.flatMap(c => c.members),
        other: true,
      },
    ]
  }
  const pcts = wholePercents(parts.map(p => p.amount))
  return {
    by,
    currency,
    total: parts.reduce((a, p) => a + p.amount, 0),
    slices: parts.map((p, i) => ({ ...p, pct: pcts[i] })),
  }
}

export type LedgerSort = 'exp' | 'cost' | 'region'
export function sortRows(rows: LedgerRow[], by: LedgerSort): LedgerRow[] {
  const exp = (r: LedgerRow) => (r.days == null ? Infinity : r.days)
  const byName = (a: LedgerRow, b: LedgerRow) => a.node.name.localeCompare(b.node.name)
  const cmp: Record<LedgerSort, (a: LedgerRow, b: LedgerRow) => number> = {
    exp: (a, b) => exp(a) - exp(b) || byName(a, b),
    cost: (a, b) => (b.monthly ?? -1) - (a.monthly ?? -1) || exp(a) - exp(b) || byName(a, b),
    region: (a, b) => a.code.localeCompare(b.code) || exp(a) - exp(b) || byName(a, b),
  }
  return [...rows].sort(cmp[by] || cmp.exp)
}
