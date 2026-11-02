// Duty-room rules, run straight from the TypeScript sources through Vite's SSR loader.
// Covers room sizing and splitting, desk geometry, character binding and the
// state → mood rules (offline, busy, alert → leader call, idle after 10 minutes).
import assert from 'node:assert/strict'
import { createServer } from 'vite'

/* Minimal browser globals the shared state module touches. */
const mem = new Map()
globalThis.window = globalThis
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const load = p => server.ssrLoadModule(p)
let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log('ok', name)
}

try {
  const { ROOM_TYPES, roomTypeFor, buildRooms, MAX_DESKS } = await load('/src/pages/duty/layout.ts')
  const { CHARACTERS, ATLASES, castNodes, characterOf, setCharacter } = await load('/src/cast/roster.ts')
  const B = await load('/src/cast/behavior.ts')
  const { S } = await load('/src/state.ts')

  const node = (i, group = '') => ({ uuid: 'n-' + i, name: 'Node ' + i, group })

  await test('room type follows configured count', () => {
    const sizes = [0, 1, 3, 4, 8, 9, 16].map(n => roomTypeFor(n).key)
    assert.deepEqual(sizes, ['small', 'small', 'small', 'medium', 'medium', 'large', 'large'])
    assert.throws(() => roomTypeFor(17), RangeError)
    assert.throws(() => roomTypeFor(-1), RangeError)
  })

  await test('every room type has one desk per seat, inside the scene', () => {
    Object.values(ROOM_TYPES).forEach(t => {
      assert.equal(t.desks.length, t.capacity, t.key)
      t.desks.forEach(d => {
        assert.ok(d.x > 0 && d.x < t.w && d.y > 0 && d.y <= t.h, t.key + ' desk inside')
        const s = d.screen
        assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.w <= t.w && s.y + s.h <= t.h, t.key + ' screen inside')
      })
    })
  })

  await test('one room per group, with a whole-floor room when it fits', () => {
    const nodes = [node(0, '亚洲'), node(1, '亚洲'), node(2, '欧洲'), node(3), node(4, '亚洲')]
    const rooms = buildRooms(nodes)
    assert.deepEqual(
      rooms.map(r => [r.id, r.title, r.nodes.length, r.type.key]),
      [
        ['all', '全员', 5, 'medium'],
        ['g:亚洲', '亚洲', 3, 'small'],
        ['g:欧洲', '欧洲', 1, 'small'],
        ['g:', '未分组', 1, 'small'],
      ],
    )
  })

  await test('groups over 16 nodes are split into pages; no whole-floor room above 16', () => {
    const nodes = [...Array.from({ length: 40 }, (_, i) => node(i, 'A')), node(40, 'B')]
    const rooms = buildRooms(nodes)
    assert.deepEqual(
      rooms.map(r => [r.id, r.part, r.nodes.length]),
      [
        ['g:A#1', '1/3', 16],
        ['g:A#2', '2/3', 16],
        ['g:A#3', '3/3', 8],
        ['g:B', '', 1],
      ],
    )
    assert.ok(rooms.every(r => r.nodes.length <= MAX_DESKS && r.type.capacity >= r.nodes.length))
  })

  await test('a single group (or none) becomes one room; empty fleet keeps an empty room', () => {
    assert.deepEqual(
      buildRooms([node(0, 'Home'), node(1, 'Home')]).map(r => r.title),
      ['Home'],
    )
    const empty = buildRooms([])
    assert.equal(empty.length, 1)
    assert.equal(empty[0].nodes.length, 0)
    assert.equal(empty[0].type.key, 'small')
  })

  await test('cast data: eight characters, four poses, atlases known', () => {
    assert.equal(CHARACTERS.length, 8)
    CHARACTERS.forEach(c => {
      assert.ok(ATLASES[c.atlas], c.key)
      ;['idle', 'work', 'coffee', 'sleep'].forEach(p => assert.equal(c.frames[p].length, 4, c.key + p))
    })
  })

  await test('characters bind to node UUIDs, vary within a group and survive reordering', () => {
    const nodes = Array.from({ length: 8 }, (_, i) => node(i, 'G'))
    castNodes(nodes)
    const first = nodes.map(n => characterOf(n.uuid).key)
    assert.equal(new Set(first).size, 8, 'eight distinct characters in one group of eight')
    castNodes([...nodes].reverse())
    assert.deepEqual(
      nodes.map(n => characterOf(n.uuid).key),
      first,
    )
    setCharacter('n-0', 'wheat')
    assert.equal(characterOf('n-0').key, 'wheat')
    assert.match(mem.get('nm-duty-cast'), /"n-0":"wheat"/)
    assert.throws(() => setCharacter('n-0', 'nobody'), RangeError)
  })

  await test('moods follow live data', () => {
    S.ts = { alert_cpu: '80' }
    const t0 = Date.UTC(2026, 9, 31, 12)
    B.sample('m-off', false, 0, 0, t0)
    assert.equal(B.moodOf('m-off', t0), 'offline')
    B.sample('m-work', true, 30, 1000, t0)
    assert.equal(B.moodOf('m-work', t0), 'work')
    B.sample('m-busy', true, 65, 1000, t0)
    assert.equal(B.moodOf('m-busy', t0), 'busy')
    B.sample('m-hot', true, 90, 1000, t0)
    assert.equal(B.moodOf('m-hot', t0), 'alert')
    B.sample('m-hot', true, 92, 1000, t0 + 61_000)
    assert.equal(B.moodOf('m-hot', t0 + 61_000), 'call')
    B.sample('m-hot', true, 40, 1000, t0 + 70_000)
    assert.equal(B.moodOf('m-hot', t0 + 70_000), 'work')
  })

  await test('idle needs ten quiet minutes; stored history counts toward it', () => {
    const t0 = Date.UTC(2026, 9, 31, 12)
    B.sample('m-idle', true, 2, 1000, t0)
    assert.equal(B.moodOf('m-idle', t0), 'work')
    B.sample('m-idle', true, 3, 1000, t0 + 9 * 60_000)
    assert.equal(B.moodOf('m-idle', t0 + 9 * 60_000), 'work')
    B.sample('m-idle', true, 3, 1000, t0 + 10 * 60_000)
    assert.equal(B.moodOf('m-idle', t0 + 10 * 60_000), 'idle')
    B.sample('m-idle', true, 30, 1000, t0 + 11 * 60_000)
    assert.equal(B.moodOf('m-idle', t0 + 11 * 60_000), 'work')

    B.sample('m-seed', true, 1, 1000, t0)
    const quiet = Array.from({ length: 15 }, (_, i) => [t0 - (15 - i) * 60_000, 1.5])
    B.seed('m-seed', quiet, t0)
    assert.equal(B.moodOf('m-seed', t0), 'idle')
    const busyBefore = quiet.map(([at], i) => [at, i < 10 ? 40 : 1.5])
    B.sample('m-seed2', true, 1, 1000, t0)
    B.seed('m-seed2', busyBefore, t0)
    assert.equal(B.moodOf('m-seed2', t0), 'work')
  })

  await test('monitor curve ends with the live value', () => {
    const c = B.curve('m-seed', 30)
    assert.equal(c.length, 16)
    assert.equal(c[c.length - 1], 1)
  })

  await test('events: spike, then the leader calls a minute later; offline, recover, reboot, idle', async () => {
    const E = await load('/src/cast/events.ts')
    const rec = (cpu, uptime) => ({ cpu, mem_used: 1, mem_total: 4, disk_used: 1, disk_total: 4, uptime })
    S.ts = { alert_cpu: '80' }
    S.loggedIn = false
    S.nodes = [
      { uuid: 'e-hot', name: 'Hot' },
      { uuid: 'e-flap', name: 'Flap' },
      { uuid: 'e-quiet', name: 'Quiet' },
    ]
    S.lastSync = new Date()
    const t0 = Date.UTC(2026, 9, 31, 13)
    const tick = (sec, hot, flapOnline, flapUptime) => {
      S.online = new Set(['e-hot', 'e-quiet', ...(flapOnline ? ['e-flap'] : [])])
      S.live = { 'e-hot': rec(hot, 5e6), 'e-flap': rec(20, flapUptime), 'e-quiet': rec(1, 5e6) }
      E.observe(t0 + sec * 1000)
    }
    for (let s = 0; s <= 700; s += 2.5)
      tick(s, s >= 10 ? 92 : 30, !(s >= 100 && s < 130), s >= 200 ? s - 195 : 5e6 + s)
    const kinds = E.dutyLog()
      .map(e => e.uuid + ':' + e.kind)
      .reverse()
    assert.deepEqual(kinds, [
      'e-hot:spike',
      'e-hot:call',
      'e-flap:offline',
      'e-flap:recover',
      'e-flap:reboot',
      'e-quiet:idle',
    ])
    const at = k => E.dutyLog().find(e => e.uuid + ':' + e.kind === k).at - t0
    assert.equal(at('e-hot:call') - at('e-hot:spike'), 60_000)
    assert.equal(at('e-quiet:idle'), 600_000)
    assert.ok(E.discovered().call.count >= 1)
    /* the home page signal log uses the plain voice: no characters, no jokes */
    E.dutyLog().forEach(e => {
      assert.ok(e.plain && e.plain.startsWith(S.nodes.find(n => n.uuid === e.uuid).name), e.kind)
      assert.ok(E.SIGNAL_TAG[e.kind], e.kind + ' tag')
    })
    assert.equal(E.dutyLog().find(e => e.kind === 'offline').plain, 'Flap 失去信号')
  })

  await test('home objects follow node data', async () => {
    const F = await load('/src/pages/home/facts.ts')
    const D = 86400
    assert.deepEqual(
      [0, 6.9 * D, 7 * D, 29 * D, 30 * D, 99 * D, 100 * D].map(F.plantStage),
      [0, 0, 1, 1, 2, 2, 3],
    )
    const TB = 1024 ** 4,
      quota = (tu, td) => F.snackLevel({ traffic_limit: 1 * TB, traffic_limit_type: 'sum' }, { tu, td })
    assert.deepEqual(F.snackLevel({ traffic_limit: 0 }, { tu: 9 * TB, td: 9 * TB }), { frame: 0, used: null })
    assert.deepEqual(
      [
        quota(0.1 * TB, 0.1 * TB),
        quota(0.3 * TB, 0.2 * TB),
        quota(0.5 * TB, 0.3 * TB),
        quota(0.5 * TB, 0.45 * TB),
      ].map(q => q.frame),
      [0, 1, 2, 3],
    )
    const inDays = d => ({ expired_at: new Date(Date.now() + d * 864e5 - 1000).toISOString() })
    assert.equal(F.expiry({}).label, '长期')
    assert.equal(F.expiry({ expired_at: '0001-01-01T00:00:00Z' }).date, null)
    assert.deepEqual([F.expiry(inDays(6)).urgent, F.expiry(inDays(6)).days], [true, 6])
    assert.equal(F.expiry(inDays(30)).urgent, false)
    assert.match(F.expiry(inDays(-2)).label, /已过期 2 天/)
    const lamp = (lat, loss = 0, timeout = false) => ({ name: 'x', lat, loss, timeout })
    assert.deepEqual(
      [null, lamp(30), lamp(150), lamp(250), lamp(30, 8), lamp(null, 0, true)].map(F.lampTone),
      ['off', 'ok', 'warn', 'bad', 'bad', 'bad'],
    )
    assert.equal(F.activity(0, 0, true), 'game')
    assert.deepEqual(
      [0, 40_000, 80_000, 120_000].map(t => F.activity(t, 0, false)),
      ['snack', 'game', 'tv', 'snack'],
    )
    assert.equal(F.isNight(new Date(2026, 9, 31, 5)), true)
    assert.equal(F.isNight(new Date(2026, 9, 31, 12)), false)
    assert.equal(F.isNight(new Date(2026, 9, 31, 19)), true)
  })

  await test('routine: typing alternates, a stretch now and then, head-scratching under load', async () => {
    const R = await load('/src/cast/routine.ts')
    const poses = (mood, from, to, step) => {
      const out = new Set()
      for (let t = from; t < to; t += step) out.add(R.deskPose(mood, t, 0))
      return out
    }
    const work = poses('work', 4000, 80_000, 37)
    assert.ok(work.has('typeA') && work.has('typeB'), 'two typing frames')
    assert.ok(!work.has('busy') && !work.has('stretch'), 'no busy, no stretch outside its window')
    assert.deepEqual([...poses('work', 0, 3400, 50)], ['stretch'], 'stretch window at the start of each 90 s')
    const busy = poses('alert', 0, 20_000, 23)
    assert.ok(busy.has('busy') && busy.has('typeA') && busy.has('typeB') && !busy.has('stretch'))
    assert.ok([...R.AT_DESK].sort().join() === 'alert,busy,call,work' && !R.AT_DESK.has('idle'))
  })

  await test('routine: errands face the viewer, and only a few leave at once', async () => {
    const R = await load('/src/cast/routine.ts')
    const free = { neighbour: true, away: 0, cap: 2 }
    assert.deepEqual(
      [0.1, 0.4, 0.7, 0.9].map(r => R.pickErrand(r, free)),
      ['coffee', 'stroll', 'visit', 'toilet'],
    )
    assert.equal(R.pickErrand(0.7, { ...free, neighbour: false }), 'stroll', 'no neighbour, no visit')
    assert.equal(R.pickErrand(0.9, { ...free, away: 2 }), 'coffee', 'room at its away cap stays by the desk')
    assert.deepEqual([1, 3, 4, 8, 16].map(R.awayCap), [1, 1, 1, 2, 4])
    assert.equal(R.ERRAND_LINE.toilet, '去趟洗手间。')
    for (const e of ['coffee', 'stroll', 'visit', 'toilet']) {
      const lo = R.errandSeconds(e, 0),
        hi = R.errandSeconds(e, 1)
      assert.ok(lo > 0 && hi > lo, e)
    }
  })

  await test('home: idle time includes a trip out, but never with a guest', async () => {
    const F = await load('/src/pages/home/facts.ts')
    const day = Array.from({ length: 7 }, (_, i) => F.activity(i * 40_000, 0, false))
    assert.deepEqual(day, ['snack', 'game', 'tv', 'snack', 'out', 'game', 'tv'])
    assert.ok(day.every((_, i) => F.activity(i * 40_000, 0, true) === 'game'))
  })

  await test('desk art data: four poses per character, anchors on the stool feet', async () => {
    const D = await load('/src/cast/desk.ts')
    const { CHARACTERS } = await load('/src/cast/roster.ts')
    CHARACTERS.forEach(c => {
      const s = D.DESK_CAST[c.key]
      assert.ok(s && s.frames.length === 4, c.key)
      s.frames.forEach((f, i) => {
        const a = D.anchor(s, f)
        assert.equal(a.x, (i % 2) * 800 + 400, c.key + ' anchor x')
        assert.ok(Math.abs(f[1] + f[3] - a.y) <= 2, c.key + ' content sits on the anchor')
      })
      assert.ok(s.ratio > 0.68 && s.ratio < 0.8, c.key + ' seated ratio')
    })
    assert.deepEqual(D.anchor(D.MUSE_WALK, D.MUSE_WALK.frames[1]), { x: 960, y: 576 })
  })

  await test('patrol: Nanomuse stops at the worst desks first, at most four', async () => {
    const P = await load('/src/pages/duty/patrol.ts')
    const t0 = Date.UTC(2026, 9, 31, 15)
    const soon = new Date(Date.now() + 3 * 864e5 - 1000).toISOString()
    S.ts = { alert_cpu: '80', alert_ram: '80', alert_disk: '90' }
    const rec = (cpu, ram = 20, disk = 20) => ({
      cpu,
      mem_used: ram,
      mem_total: 100,
      disk_used: disk,
      disk_total: 100,
      uptime: 9e5,
    })
    const nodes = [
      { uuid: 'p-ok', name: 'Calm' },
      { uuid: 'p-busy', name: 'Busy' },
      { uuid: 'p-exp', name: 'Rent', expired_at: soon },
      { uuid: 'p-ram', name: 'Mem' },
      { uuid: 'p-hot', name: 'Hot' },
      { uuid: 'p-off', name: 'Gone' },
    ]
    S.nodes = nodes
    S.online = new Set(nodes.map(n => n.uuid).filter(u => u !== 'p-off'))
    S.live = {
      'p-ok': rec(20),
      'p-busy': rec(65),
      'p-exp': rec(10),
      'p-ram': rec(10, 85),
      'p-hot': rec(92),
      'p-off': rec(0),
    }
    nodes.forEach(n => B.sample(n.uuid, S.online.has(n.uuid), S.live[n.uuid].cpu, 9e5, t0 - 1000))
    nodes.forEach(n => B.sample(n.uuid, S.online.has(n.uuid), S.live[n.uuid].cpu, 9e5, t0))
    const stops = P.patrolStops(nodes, t0)
    assert.deepEqual(
      stops.map(s => s.uuid),
      ['p-off', 'p-hot', 'p-ram', 'p-exp'],
    )
    assert.equal(stops[0].line, 'Gone 掉线了，我记下了。')
    assert.equal(stops[2].line, 'Mem 内存 85%，我记下了。')
    assert.match(stops[3].line, /Rent 还有 3 天到期/)
    assert.deepEqual(P.patrolStops([nodes[0]], t0), [], 'all well: no stops')
  })

  await test('visits: lines take turns, follow the host and run on a clock', async () => {
    const C = await load('/src/cast/chat.ts')
    const facts = host => ({ host, name: '小蓝', cpu: 2.4, days: 120 })
    const rolls = [0, 0.2, 0.4, 0.6, 0.8, 0.99]
    for (const host of ['idle', 'work']) {
      const scripts = rolls.map(r => C.chatScript(facts(host), r))
      assert.ok(new Set(scripts.map(s => s[0].text)).size >= 3, host + ': several topics')
      for (const s of scripts) {
        assert.equal(s[0].by, 'guest', host + ': the guest opens')
        assert.ok(s.length >= 2 && s.every(l => l.text), host + ': a real exchange')
        s.forEach((l, i) => i && assert.notEqual(l.by, s[i - 1].by, host + ': turns alternate'))
      }
    }
    const idle = rolls.map(r =>
      C.chatScript(facts('idle'), r)
        .map(l => l.text)
        .join(' '),
    )
    assert.ok(
      idle.some(t => t.includes('CPU 才 2%')),
      'quiet CPU from live data',
    )
    assert.ok(
      idle.some(t => t.includes('跑了 120 天')),
      'long uptime mentioned',
    )
    const fresh = rolls.map(r =>
      C.chatScript({ ...facts('idle'), days: 3 }, r)
        .map(l => l.text)
        .join(' '),
    )
    assert.ok(!fresh.some(t => t.includes('天了吧')), 'no uptime topic on a fresh node')
    assert.ok(C.chatScript(facts('work'), 0)[0].text.startsWith('小蓝'), 'the guest calls the host by name')
    assert.equal(C.chatScript(facts('busy'), 0.5)[0].by, 'host', 'a busy host cuts in first')
    assert.deepEqual(
      C.chatScript(facts('away'), 0.5).map(l => l.by),
      ['guest'],
      'nobody home: the guest talks to themselves',
    )
    assert.equal(C.INTERRUPTED[0].by, 'host')
    const s = C.chatScript(facts('work'), 0.4)
    assert.equal(C.chatMs(s), s.length * C.LINE_MS)
    assert.equal(C.chatAt(s, 0).index, 0)
    assert.equal(C.chatAt(s, C.LINE_MS * 1.5).line, s[1])
    assert.equal(C.chatAt(s, C.chatMs(s)), null, 'over after the last line')
    assert.equal(C.chatAt(s, -1), null)
  })

  console.log(`duty: ${passed} checks passed`)
} finally {
  await server.close()
}
