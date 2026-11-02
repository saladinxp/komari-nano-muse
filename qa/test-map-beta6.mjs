// 2.1.0-beta.6 Star Map maths (auto zoom, arcs, link status, labels), from the TS sources via Vite SSR.
import assert from 'node:assert/strict'
import { createServer } from 'vite'

/* echo-presets.ts reaches the shared state module, which touches these at load. */
const mem = new Map()
globalThis.window = globalThis
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
}

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log('ok', name)
}

try {
  const M = await server.ssrLoadModule('/src/pages/map/model.ts')
  const { ECHO_SITES, DOMESTIC_PRESET_KEYS } = await server.ssrLoadModule('/src/data/echo-sites.ts')
  const { ECHO_PRESETS } = await server.ssrLoadModule('/src/nodes/echo-presets.ts')
  const P = (lat, lng) => M.project(lat, lng)
  const hebei = P(...ECHO_SITES['124.237.177.164'].at)

  await test('Mercator projection matches the land outline space', () => {
    assert.deepEqual(M.project(0, 0).x, 480)
    assert.equal(M.project(90, 0).y, M.project(83, 0).y, 'latitude clamped to the outline')
    assert.ok(M.project(51.5, 0).y < M.project(0, 0).y)
  })

  await test('node placement: node_coords setting → name → region (flag or code); duplicates fan out', () => {
    const used = new Map()
    assert.deepEqual(
      M.locate({ uuid: 'u1', name: 'Box', region: 'JP' }, 'u1: 10.5, 20.25; u2:1,2', used),
      [10.5, 20.25],
    )
    assert.deepEqual(M.locate({ uuid: 'a', name: 'Tokyo 01', region: 'US' }, '', used), [35.68, 139.69])
    const flag = M.locate({ uuid: 'b', name: 'Box', region: '🇯🇵' }, '', used)
    const code = M.locate({ uuid: 'c', name: 'Box', region: 'JP' }, '', used)
    assert.deepEqual(flag, [36.2, 138.25])
    assert.notDeepEqual(code, flag, 'second node on the same point is spread')
    assert.ok(Math.hypot(code[0] - flag[0], code[1] - flag[1]) < 1)
    assert.equal(M.locate({ uuid: 'd', name: 'Mystery', region: '' }, '', used), null)
  })

  await test('the arc target follows the preset targets through the data file', () => {
    const targets = ECHO_PRESETS.map(p => ({ key: p.key, target: p.target }))
    assert.equal(M.arcTarget(targets, ECHO_SITES, DOMESTIC_PRESET_KEYS).name, '河北')
    const custom = targets.map(t => ({
      ...t,
      target: t.key === 'google' ? t.target : '203.0.113.' + t.key.length,
    }))
    assert.equal(
      M.arcTarget(custom, ECHO_SITES, DOMESTIC_PRESET_KEYS),
      null,
      'unknown place: no guessed arcs',
    )
    const mixed = targets.map(t => (t.key === 'telecom' ? { ...t, target: '203.0.113.9' } : t))
    assert.equal(M.arcTarget(mixed, ECHO_SITES, DOMESTIC_PRESET_KEYS).name, '河北')
    assert.equal(
      M.arcTarget(
        [{ key: 'google', target: '8.8.8.8' }],
        { '8.8.8.8': { name: 'x', at: [0, 0] } },
        DOMESTIC_PRESET_KEYS,
      ),
      null,
    )
  })

  await test('auto zoom: Asia-only nodes show Asia; a world fleet shows the world; ~2.3 : 1', () => {
    const asia = [P(35.68, 139.69), P(22.32, 114.17), P(1.35, 103.82), P(37.57, 126.98), hebei]
    const v = M.fitView(asia)
    assert.ok(v.x > 560 && v.w < 420, JSON.stringify(v))
    assert.ok(Math.abs(v.w / v.h - 2.3) < 1e-9)
    for (const p of asia) assert.ok(p.x > v.x && p.x < v.x + v.w && p.y > v.y && p.y < v.y + v.h, 'inside')
    const world = [...asia, P(34.05, -118.24), P(51.51, -0.13), P(-33.87, 151.21)]
    const wv = M.fitView(world)
    assert.ok(wv.w > 800, JSON.stringify(wv))
    for (const p of world) assert.ok(p.x > wv.x && p.x < wv.x + wv.w && p.y > wv.y && p.y < wv.y + wv.h)
    const poles = M.fitView([P(70, -170), P(-50, 170)])
    assert.equal(poles.w, 960, 'a fleet wider than the map shows the whole width')
    assert.ok(poles.w / poles.h >= 2 - 1e-9)
    assert.ok(wv.w / wv.h >= 2 - 1e-9 && wv.w / wv.h <= 2.3 + 1e-9)
    assert.ok(wv.y >= 0 && wv.y + wv.h <= 480)
    const one = M.fitView([P(1.35, 103.82)])
    assert.ok(one.w >= 210 && one.x >= 0 && one.x + one.w <= 960)
    assert.equal(M.fitView([]).w, 960)
  })

  await test('arcs bulge north, north–south links bend west; screen mapping is uniform', () => {
    const la = P(34.05, -118.24),
      c = M.arcControl(la, hebei)
    assert.ok(c.y < Math.min(la.y, hebei.y), 'east–west arc rises')
    const sg = P(1.35, 103.82),
      c2 = M.arcControl(sg, hebei)
    assert.ok(c2.x < (sg.x + hebei.x) / 2, 'south–north arc bends west')
    assert.ok(M.arcApex(la, hebei).y < la.y)
    assert.match(M.arcPath({ x: 0, y: 10 }, { x: 100, y: 10 }), /^M0\.0 10\.0Q50\.0 -10\.0 100\.0 10\.0$/)
    const view = { x: 100, y: 50, w: 200, h: 100 }
    assert.deepEqual(M.toScreen({ x: 300, y: 150 }, view, 800), { x: 800, y: 400 })
  })

  /* One hour of 60 s samples ending just before `now`. */
  const now = Date.UTC(2026, 10, 1, 12)
  const task = fn => {
    const samples = Array.from({ length: 60 }, (_, i) => {
      const s = fn(i)
      return {
        t: now - (59 - i) * 60_000 - 30_000,
        lat: s.lat ?? null,
        loss: s.loss ?? (s.lat == null ? 1 : 0),
        timeout: s.lat == null,
        hasLatency: true,
      }
    })
    return { samples, points: samples, interval: 60, bucketSeconds: 0 }
  }
  const stable = task(() => ({ lat: 50 })),
    spiky = task(i => ({ lat: i === 30 ? 160 : 50 })),
    partial = task(i => (i === 10 ? { lat: 52, loss: 0.25 } : { lat: 50 })),
    lost = task(() => ({})),
    failingNow = task(i => (i >= 57 ? {} : { lat: 50 })),
    empty = { samples: [], points: [], interval: 60 }

  await test('one line: same cells and rules as the Echo trend', () => {
    assert.equal(M.lineQuality(stable, now), 'stable')
    assert.equal(M.lineQuality(spiky, now), 'unstable', 'latency spike')
    assert.equal(M.lineQuality(partial, now), 'unstable', 'partial loss')
    assert.equal(M.lineQuality(lost, now), 'lost')
    assert.equal(M.lineQuality(failingNow, now), 'lost', 'latest three cells lost: failing now')
    assert.equal(M.lineQuality(empty, now), 'missing')
    assert.equal(M.lineQuality(undefined, now), 'missing')
    const old = task(() => ({ lat: 50 }))
    old.samples.forEach(s => (s.t -= 2 * 3_600_000))
    assert.equal(M.lineQuality(old, now), 'missing', 'samples older than an hour do not count')
  })

  await test('node arc: stable / unstable / lost / offline / no data / not drawn', () => {
    const L = (t, message) => ({ name: 'x', task: t, message })
    assert.equal(M.nodeLink([L(stable), L(stable), L(stable)], true, now), 'stable')
    assert.equal(M.nodeLink([L(stable), L(partial), L(stable)], true, now), 'unstable')
    assert.equal(
      M.nodeLink([L(lost), L(stable), L(stable)], true, now),
      'unstable',
      'one carrier lost → amber',
    )
    assert.equal(M.nodeLink([L(lost), L(lost), L(undefined, '等待采样')], true, now), 'lost')
    assert.equal(M.nodeLink([L(stable), L(stable), L(stable)], false, now), 'offline')
    assert.equal(
      M.nodeLink([L(undefined, '等待采样'), L(undefined, '等待采样'), L(undefined, '等待采样')], true, now),
      'missing',
    )
    assert.equal(
      M.nodeLink(
        [L(undefined, '该节点未分配'), L(undefined, '尚未启用'), L(undefined, '待管理员更新目标')],
        true,
        now,
      ),
      'none',
    )
    assert.equal(M.nodeLink([], true, now), 'none', 'default lines not enabled')
    assert.equal(M.worstLink(['stable', 'offline', 'unstable']), 'unstable')
    assert.equal(M.worstLink(['offline', 'missing']), 'missing')
    assert.equal(M.worstLink([]), 'none')
  })

  await test('latency medians use answered samples only', () => {
    assert.equal(M.median([]), null)
    assert.equal(M.median([3, 1, 2]), 2)
    assert.equal(M.median([4, 1, 2, 3]), 2.5)
    assert.equal(M.answered(lost).length, 0)
    assert.equal(M.answered(failingNow).length, 57)
    assert.equal(M.median(M.answered(spiky)), 50)
  })

  const FLEET = [
    ['la', 34.05, -118.24, 'US'],
    ['sj', 37.34, -121.89, 'US'],
    ['se', 47.61, -122.33, 'US'],
    ['ny', 40.71, -74.01, 'US'],
    ['to', 43.65, -79.38, 'CA'],
    ['f', 50.11, 8.68, 'DE'],
    ['a', 52.37, 4.9, 'NL'],
    ['l', 51.51, -0.13, 'GB'],
    ['p', 48.86, 2.35, 'FR'],
    ['t', 35.68, 139.69, 'JP'],
    ['o', 34.69, 135.5, 'JP'],
    ['s', 37.57, 126.98, 'KR'],
    ['hk', 22.32, 114.17, 'HK'],
    ['tw', 25.03, 121.57, 'TW'],
    ['sg', 1.35, 103.82, 'SG'],
    ['au', -33.87, 151.21, 'AU'],
  ]
  const labelCase = (rows, width) => {
    const base = rows.map(([, lat, lng]) => P(lat, lng))
    const view = M.fitView([...base, hebei, ...base.map(b => M.arcApex(b, hebei))])
    const pts = rows.map(([id, lat, lng, code]) => ({
      id,
      code,
      name: id,
      ...M.toScreen(P(lat, lng), view, width),
    }))
    const t = M.toScreen(hebei, view, width)
    const target = { x: t.x - 96, y: t.y - 7, w: 88, h: 14 }
    const bounds = { x: 0, y: 0, w: width, h: (width * view.h) / view.w }
    const labels = M.clusterLabels(pts, { avoid: [target], bounds })
    const visible = labels.filter(l => !l.hidden)
    for (const [i, a] of visible.entries()) {
      assert.ok(!M.overlaps(a, target), 'label over the target label: ' + a.text)
      assert.ok(
        a.x >= 0 && a.y >= 0 && a.x + a.w <= bounds.w && a.y + a.h <= bounds.h,
        'inside the map: ' + a.text,
      )
      for (const b of visible.slice(i + 1)) assert.ok(!M.overlaps(a, b), `${a.text} overlaps ${b.text}`)
      for (const p of pts)
        assert.ok(!M.overlaps(a, { x: p.x - 4, y: p.y - 4, w: 8, h: 8 }), `${a.text} covers ${p.id}`)
    }
    assert.equal(
      labels.reduce((a, l) => a + l.count, 0),
      rows.length,
      'every node in exactly one label',
    )
    return labels
  }

  await test('labels: neighbours merge ("DE · NL · GB · FR 4"); none overlaps another, a dot or the target', () => {
    const labels = labelCase(FLEET, 1100)
    const eu = labels.find(l => l.ids.includes('f'))
    assert.deepEqual(eu.ids.sort(), ['a', 'f', 'l', 'p'])
    assert.deepEqual(eu.text.replace(/ 4$/, '').split(' · ').sort(), ['DE', 'FR', 'GB', 'NL'])
    assert.match(eu.text, / 4$/)
    assert.equal(labels.filter(l => l.hidden).length, 0, 'every label placed')
    // Zoomed in (Europe + East Asia only), dots sit further apart; still no overlaps and nothing hidden.
    const zoomed = labelCase(
      FLEET.filter(r => ['f', 'a', 'l', 'p', 't', 'o', 's'].includes(r[0])),
      1100,
    )
    assert.equal(zoomed.filter(l => l.hidden).length, 0)
    const narrow = labelCase(FLEET, 720)
    assert.equal(narrow.filter(l => l.hidden).length, 0, '720 px map still places every label')
  })

  await test('labels stay apart for a dense random fleet', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    const codes = ['US', 'JP', 'DE', 'SG', 'HK', 'GB', 'NL', 'FR', 'KR', 'TW']
    const pts = Array.from({ length: 60 }, (_, i) => ({
      id: 'n' + i,
      code: codes[i % codes.length],
      name: 'n' + i,
      x: 30 + rnd() * 1040,
      y: 20 + rnd() * 440,
    }))
    const labels = M.clusterLabels(pts, { bounds: { x: 0, y: 0, w: 1100, h: 480 } })
    const visible = labels.filter(l => !l.hidden)
    for (const [i, a] of visible.entries())
      for (const b of visible.slice(i + 1)) assert.ok(!M.overlaps(a, b), `${a.text} overlaps ${b.text}`)
    assert.equal(
      labels.reduce((a, l) => a + l.count, 0),
      60,
      'every node belongs to one label',
    )
    assert.ok(visible.length >= labels.length * 0.8, `${visible.length}/${labels.length} placed`)
  })

  console.log(`map beta.6: ${passed} checks passed`)
} finally {
  await server.close()
}
