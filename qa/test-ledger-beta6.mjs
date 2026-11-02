// 2.1.0-beta.6 Ledger maths, run from the TypeScript sources through Vite's SSR loader.
// Fixed local dates (noon) keep the checks independent of the run day; no exchange rates anywhere.
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log('ok', name)
}
const day = (y, m, d) => new Date(y, m - 1, d, 12)
const iso = d => d.toISOString()
const ymd = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

try {
  const L = await server.ssrLoadModule('/src/pages/ledger/model.ts')
  const now = day(2026, 11, 1)
  const node = (name, extra) => ({ uuid: name, name, currency: 'USD', ...extra })
  const rowsOf = nodes => nodes.map(n => L.ledgerRow(n, now))

  await test('cycles follow Komari renewal bands; other values stay plain days', () => {
    const c = v => L.cycleOf(v)
    assert.deepEqual(
      [30, 31, 92, 184, 365, 730, 1095, 1825].map(v => [c(v).label, c(v).months]),
      [
        ['月付', 1],
        ['月付', 1],
        ['季付', 3],
        ['半年付', 6],
        ['年付', 12],
        ['两年付', 24],
        ['三年付', 36],
        ['五年付', 60],
      ],
    )
    assert.equal(c('365').label, '年付', 'stringified cycle')
    assert.deepEqual([c(45).label, c(45).months, c(45).days], ['每 45 天', null, 45])
    assert.equal(c(-1).label, '一次性')
    assert.equal(c(-1).oneTime, true)
    for (const bad of [0, '', undefined, null, 'x', -5]) assert.equal(c(bad), null, String(bad))
    // Band edges exactly as Komari's renewal.go: inside → calendar months, outside → plain days.
    assert.deepEqual(
      [26, 27, 32, 33, 87, 95, 96, 175, 185, 186, 360, 370, 371, 720, 750, 1080, 1150, 1800, 1850, 1851].map(
        v => c(v).months,
      ),
      [null, 1, 1, null, 3, 3, null, 6, 6, null, 12, 12, null, 24, 24, 36, 36, 60, 60, null],
    )
  })

  await test('monthly equivalent, currency normalisation and price kinds', () => {
    assert.equal(L.monthlyOf(node('y', { price: 48, billing_cycle: 365 })), 4)
    assert.equal(L.monthlyOf(node('m', { price: 15, billing_cycle: 30 })), 15)
    assert.equal(L.monthlyOf(node('q', { price: 30, billing_cycle: 92 })), 10)
    assert.equal(L.monthlyOf(node('2y', { price: 96, billing_cycle: 730 })), 4)
    assert.ok(
      Math.abs(L.monthlyOf(node('45', { price: 30, billing_cycle: 45 })) - (30 * 365.25) / 12 / 45) < 1e-9,
    )
    assert.equal(L.monthlyOf(node('free', { price: -1, billing_cycle: 30 })), null)
    assert.equal(L.monthlyOf(node('none', { price: 0, billing_cycle: 30 })), null)
    assert.equal(L.monthlyOf(node('nocycle', { price: 10, billing_cycle: 0 })), null)
    assert.equal(L.monthlyOf(node('once', { price: 10, billing_cycle: -1 })), null)
    assert.equal(L.currencyOf({ currency: '' }), '$', 'Komari default')
    assert.equal(L.currencyOf({}), '$')
    assert.equal(L.currencyOf({ currency: ' usd ' }), 'USD')
    assert.equal(L.currencyOf({ currency: '¥' }), '¥')
    assert.equal(L.money('USD', 70), 'USD 70.00', 'letter code: space before the number')
    assert.equal(L.money('$', 70), '$70.00', 'symbol (Komari default $): against the number')
    assert.equal(L.priceMoney('¥', 15), '¥15', '¥ stays ¥, never guessed as CNY or JPY')
    assert.equal(L.priceMoney('€', 4.5), '€4.5')
    assert.equal(L.priceMoney('US$', 5), 'US$5')
    assert.equal(L.priceText(48), '48')
    assert.equal(L.priceText(4.5), '4.5')
  })

  await test('renewal projection: monthly / quarterly / yearly / multi-year across the year end', () => {
    const rows = rowsOf([
      node('Monthly', { price: 15, currency: 'CNY', billing_cycle: 30, expired_at: iso(day(2026, 11, 20)) }),
      node('Quarterly', { price: 30, currency: 'EUR', billing_cycle: 92, expired_at: iso(day(2026, 12, 5)) }),
      node('Yearly', { price: 48, billing_cycle: 365, expired_at: iso(day(2027, 1, 20)) }),
      node('TwoYear', { price: 96, billing_cycle: 730, expired_at: iso(day(2027, 2, 10)) }),
      node('FarYearly', { price: 60, billing_cycle: 365, expired_at: iso(day(2027, 12, 1)) }),
    ])
    const r = L.projectRenewals(rows, now)
    const of = name => r.filter(x => x.name === name).map(x => ymd(x.date))
    assert.deepEqual(of('Monthly'), [
      '2026-11-20',
      '2026-12-20',
      '2027-01-20',
      '2027-02-20',
      '2027-03-20',
      '2027-04-20',
      '2027-05-20',
      '2027-06-20',
      '2027-07-20',
      '2027-08-20',
      '2027-09-20',
      '2027-10-20',
    ])
    assert.deepEqual(of('Quarterly'), ['2026-12-05', '2027-03-05', '2027-06-05', '2027-09-05'])
    assert.deepEqual(of('Yearly'), ['2027-01-20'])
    assert.deepEqual(of('TwoYear'), ['2027-02-10'])
    assert.deepEqual(of('FarYearly'), [], 'beyond the 12-month window')
    const cal = L.renewalCalendar(r, now)
    assert.equal(cal.length, 12)
    assert.deepEqual(
      cal.map(b => `${b.year}-${b.month}`),
      ['2026-11', '2026-12', ...Array.from({ length: 10 }, (_, i) => `2027-${i + 1}`)],
    )
    assert.deepEqual(cal[0].totals, { CNY: 15 })
    assert.deepEqual(cal[1].totals, { CNY: 15, EUR: 30 }, 'currencies stay separate, never added together')
    assert.deepEqual(cal[2].totals, { CNY: 15, USD: 48 })
    assert.deepEqual(cal[3].totals, { CNY: 15, USD: 96 })
  })

  await test('projection follows Komari AddDate month overflow (Jan 31 + 1 month = Mar 3)', () => {
    const rows = rowsOf([node('Edge', { price: 5, billing_cycle: 30, expired_at: iso(day(2027, 1, 31)) })])
    const dates = L.projectRenewals(rows, now).map(x => ymd(x.date))
    assert.deepEqual(dates.slice(0, 3), ['2027-01-31', '2027-03-03', '2027-04-03'])
  })

  await test('leap day: a yearly cycle from Feb 29 moves like Go AddDate (to Mar 1)', () => {
    assert.equal(ymd(L.addCycle(day(2028, 2, 29), L.cycleOf(365))), '2029-03-01')
    assert.equal(ymd(L.addCycle(day(2028, 2, 29), L.cycleOf(30))), '2028-03-29')
    assert.equal(ymd(L.addCycle(day(2027, 3, 31), L.cycleOf(92))), '2027-07-01')
  })

  await test('months are local: a 03:00 Beijing renewal on the 1st belongs to that month', () => {
    const tz = process.env.TZ
    process.env.TZ = 'Asia/Shanghai'
    try {
      const at = new Date('2026-11-30T17:30:00Z') // 2026-12-01 01:30 in Beijing
      const rows = [
        L.ledgerRow(node('Dawn', { price: 5, billing_cycle: 30, expired_at: '2026-11-30T19:00:00Z' }), at),
      ]
      assert.equal(rows[0].days, 0, 'due today in Beijing, not yesterday')
      const cal = L.renewalCalendar(L.projectRenewals(rows, at), at)
      assert.deepEqual([cal[0].year, cal[0].month], [2026, 12], 'current month is December in Beijing')
      assert.deepEqual(cal[0].totals, { USD: 5 })
      assert.equal(L.summarize(rows, L.projectRenewals(rows, at), at).soon.nodes, 1)
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })

  await test('auto_renewal is passed through when Komari sends it', () => {
    const [on, off, none] = rowsOf([
      node('On', { price: 5, billing_cycle: 30, auto_renewal: true, expired_at: iso(day(2026, 11, 9)) }),
      node('Off', { price: 5, billing_cycle: 30, auto_renewal: false, expired_at: iso(day(2026, 11, 9)) }),
      node('Old', { price: 5, billing_cycle: 30, expired_at: iso(day(2026, 11, 9)) }),
    ])
    assert.deepEqual([on.auto, off.auto, none.auto], [true, false, null])
    assert.equal(L.projectRenewals([on], now)[0].auto, true)
  })

  await test('expired, long-term, free, unpriced and one-time nodes are never projected', () => {
    const rows = rowsOf([
      node('Expired', { price: 10, billing_cycle: 30, expired_at: iso(day(2026, 10, 25)) }),
      node('LongTerm', { price: 10, billing_cycle: 30 }),
      node('Ancient', { price: 10, billing_cycle: 30, expired_at: '0001-01-01T00:00:00Z' }),
      node('Free', { price: -1, billing_cycle: 30, expired_at: iso(day(2026, 11, 10)) }),
      node('NoPrice', { billing_cycle: 30, expired_at: iso(day(2026, 11, 10)) }),
      node('Once', { price: 99, billing_cycle: -1, expired_at: iso(day(2026, 11, 10)) }),
    ])
    assert.deepEqual(L.projectRenewals(rows, now), [])
    assert.equal(rows[0].state, 'expired')
    assert.equal(rows[0].days, -7)
    assert.equal(rows[1].state, 'none')
    assert.equal(rows[2].expiry, null, 'year 0001 means no expiry')
  })

  // The two data bugs from docs/claude-review-map-ledger.md.
  await test('annual estimate keeps every currency (bug: non-main currencies were dropped)', () => {
    const rows = rowsOf([
      node('A', { price: 48, billing_cycle: 365, expired_at: iso(day(2027, 3, 1)) }),
      node('B', { price: 98, billing_cycle: 365, expired_at: iso(day(2027, 4, 1)) }),
      node('C', { price: 15, currency: 'CNY', billing_cycle: 30, expired_at: iso(day(2026, 11, 15)) }),
      node('D', { price: 9, currency: 'EUR', billing_cycle: 92, expired_at: iso(day(2026, 12, 15)) }),
    ])
    const s = L.summarize(rows, L.projectRenewals(rows, now), now)
    assert.deepEqual(Object.keys(s.annual).sort(), ['CNY', 'EUR', 'USD'])
    assert.equal(s.annual.USD.toFixed(2), '146.00')
    assert.equal(s.annual.CNY.toFixed(2), '180.00')
    assert.equal(s.annual.EUR.toFixed(2), '36.00')
    assert.deepEqual(s.currencies, ['CNY', 'USD', 'EUR'], 'largest monthly first, no conversion')
    assert.deepEqual(L.moneyParts(s.monthly), ['CNY 15.00', 'USD 12.17', 'EUR 3.00'])
  })

  await test('30-day renewals: today..30 days only; expired nodes counted apart (bug: dl <= 30 included them)', () => {
    const rows = rowsOf([
      node('Expired3', { price: 10, billing_cycle: 365, expired_at: iso(day(2026, 10, 29)) }),
      node('Today', { price: 7, billing_cycle: 365, expired_at: iso(day(2026, 11, 1)) }),
      node('In10', { price: 26, billing_cycle: 365, expired_at: iso(day(2026, 11, 11)) }),
      node('In30', { price: 15, currency: 'CNY', billing_cycle: 30, expired_at: iso(day(2026, 12, 1)) }),
      node('In31', { price: 99, billing_cycle: 365, expired_at: iso(day(2026, 12, 2)) }),
      node('FreeSoon', { price: -1, expired_at: iso(day(2026, 11, 5)) }),
    ])
    const s = L.summarize(rows, L.projectRenewals(rows, now), now)
    assert.equal(s.soon.nodes, 3)
    assert.deepEqual(s.soon.totals, { USD: 33, CNY: 15 })
    assert.equal(s.soon.unbilled, 1, 'free node expiring soon is listed apart, not added to the amount')
    assert.deepEqual(
      s.expired.map(r => r.node.name),
      ['Expired3'],
    )
    assert.equal(s.expiredBilled, 1)
    assert.equal(ymd(s.next.date), '2026-11-01')
    assert.deepEqual(
      s.next.items.map(r => r.name),
      ['Today'],
    )
    assert.deepEqual(
      rows.map(r => r.state),
      ['expired', 'soon', 'soon', 'soon', 'ok', 'soon'],
    )
  })

  await test('next renewal groups every node due the same day', () => {
    const rows = rowsOf([
      node('Tokyo', { price: 48, billing_cycle: 365, expired_at: iso(day(2026, 11, 7)) }),
      node('Osaka', { price: 9, currency: 'EUR', billing_cycle: 30, expired_at: iso(day(2026, 11, 7)) }),
      node('Later', { price: 1, billing_cycle: 30, expired_at: iso(day(2026, 11, 9)) }),
    ])
    const s = L.summarize(rows, L.projectRenewals(rows, now), now)
    assert.deepEqual(s.next.items.map(r => r.name).sort(), ['Osaka', 'Tokyo'])
  })

  await test('cycle progress and per-core monthly', () => {
    const [half, expired, long, free, nocores] = rowsOf([
      node('Half', { price: 48, billing_cycle: 365, cpu_cores: 4, expired_at: iso(day(2027, 5, 2)) }),
      node('Old', { price: 48, billing_cycle: 365, cpu_cores: 4, expired_at: iso(day(2026, 10, 1)) }),
      node('Long', { price: 48, billing_cycle: 365, cpu_cores: 4 }),
      node('Free', { price: -1, billing_cycle: 365, cpu_cores: 4, expired_at: iso(day(2027, 1, 1)) }),
      node('NoCores', { price: 48, billing_cycle: 365, expired_at: iso(day(2027, 1, 1)) }),
    ])
    assert.ok(Math.abs(half.used - 0.5) < 0.01, String(half.used))
    assert.equal(expired.used, 1)
    assert.equal(long.used, null)
    assert.equal(half.perCore, 1)
    assert.equal(free.perCore, null)
    assert.equal(nocores.perCore, null)
  })

  await test('composition by group, folding the rest into one 其他; percents add up to 100', () => {
    const g = (name, group, price) =>
      node(name, { group, price, billing_cycle: 30, expired_at: iso(day(2027, 1, 1)) })
    const rows = rowsOf([
      g('a1', '亚洲', 30),
      g('a2', '亚洲', 10),
      g('b', '美洲', 30),
      g('c', '欧洲', 20),
      g('d', '大洋洲', 7),
      g('e', '', 3),
      node('cny', {
        group: '亚洲',
        price: 100,
        currency: 'CNY',
        billing_cycle: 30,
        expired_at: iso(day(2027, 1, 1)),
      }),
    ])
    const c = L.composition(rows, 'USD')
    assert.equal(c.by, 'group')
    assert.deepEqual(
      c.slices.map(s => [s.label, s.amount, s.pct, !!s.other]),
      [
        ['亚洲', 40, 40, false],
        ['美洲', 30, 30, false],
        ['欧洲', 20, 20, false],
        ['其他 2 组', 10, 10, true],
      ],
    )
    assert.deepEqual(c.slices[3].members.sort(), ['d', 'e'])
    assert.equal(L.composition(rows, 'CNY').slices.length, 1, 'other currencies are never mixed in')
    const single = L.composition(rows.slice(0, 5), 'USD')
    assert.equal(single.slices[3].label, '其他 · 大洋洲')
  })

  await test('composition falls back to regions when no node has a group', () => {
    const r = (name, region, price) => node(name, { region, price, billing_cycle: 30 })
    const c = L.composition(
      rowsOf([r('t', 'JP', 10), r('o', '🇯🇵', 10), r('s', 'SG', 5), r('x', '', 1)]),
      'USD',
    )
    assert.equal(c.by, 'region')
    assert.deepEqual(
      c.slices.map(s => [s.key, s.label]),
      [
        ['JP', '日本'],
        ['SG', '新加坡'],
        ['--', '未填地区'],
      ],
    )
    assert.deepEqual(L.wholePercents([1, 1, 1]), [34, 33, 33])
    assert.deepEqual(L.wholePercents([0, 0]), [0, 0])
  })

  await test('sorting by expiry, monthly and region', () => {
    const rows = rowsOf([
      node('B', { region: 'US', price: 10, billing_cycle: 30, expired_at: iso(day(2027, 2, 1)) }),
      node('A', { region: 'JP', price: 48, billing_cycle: 365, expired_at: iso(day(2026, 12, 1)) }),
      node('C', { region: 'JP', price: -1 }),
      node('D', { region: 'DE', price: 5, billing_cycle: 30, expired_at: iso(day(2026, 10, 1)) }),
    ])
    const names = by => L.sortRows(rows, by).map(r => r.node.name)
    assert.deepEqual(names('exp'), ['D', 'A', 'B', 'C'])
    assert.deepEqual(names('cost'), ['B', 'D', 'A', 'C'])
    assert.deepEqual(names('region'), ['D', 'A', 'C', 'B'])
  })

  console.log(`ledger beta.6: ${passed} checks passed`)
} finally {
  await server.close()
}
