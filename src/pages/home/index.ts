/* 居家办公: the top of the node detail page. The node's worker at home, every
   object tied to real data, and a legend that spells each one out. The exact
   readouts (gauges) sit right beside it; spec table and charts stay below.

   The loop runs only while the detail page is shown and the tab is visible. */
import { getJson, hasMetricStore, pingTasks, probesFor, queryMetrics } from '../../api/client'
import { MOOD_LABEL, moodOf, trackOf } from '../../cast/behavior'
import { checkLoss, MOMENTS, onDutyEvent } from '../../cast/events'
import { seedHistory } from '../../cast/history'
import { castNodes, characterOf } from '../../cast/roster'
import { packEcho } from '../../nodes/echo'
import { customTasks, echoGroup, presetRows } from '../../nodes/echo-presets'
import { nav } from '../../router'
import { S, visible } from '../../state'
import type { MetricPoint } from '../../types/komari'
import { $, esc, fMs, fS, fUp } from '../../utils/format'
import { metrics } from '../../utils/metrics'
import {
  activity,
  expiry,
  isNight,
  type Lamp,
  lampTone,
  PLANT_LABEL,
  plantStage,
  SNACK_LABEL,
  snackLevel,
} from './facts'
import { HomeScene, type Spot, type Visit } from './scene'

let scene: HomeScene | null = null
let uuid: string | null = null
let raf = 0
let lastDraw = 0
let pokes = 0
let lines: Lamp[] | null = null
/** Probes are assigned to this node, even if none reported in the last hour. */
let probed = false
/** Which group the panel shows: the Echo choice (admin setting 「回声默认目标组」, or the
    visitor's own Echo switch). Default lines and custom targets never share the panel. */
let lineGroup: 'preset' | 'custom' = 'custom'
let linesAt = 0
let guestId: string | null = null

const motionOff = () =>
  document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches
const node = () => S.nodes.find(n => n.uuid === uuid)
/** Nanomuse calls first; after five minutes of calls, or when the power is out, she visits. */
const VISIT_AFTER = 5 * 60_000

/* ── loop ── */
function frame(now: number): void {
  raf = 0
  if (S.page !== 'detail' || document.hidden || !uuid) return
  scene.reduced = motionOff()
  if (now - lastDraw >= (scene.reduced ? 500 : 33)) {
    lastDraw = now
    scene.draw(now)
  }
  raf = requestAnimationFrame(frame)
}
const start = () => {
  if (!raf && S.page === 'detail' && !document.hidden && uuid) raf = requestAnimationFrame(frame)
}

/* ── probe lines for the network panel ── */
async function loadLines(force = false): Promise<void> {
  const id = uuid,
    now = Date.now()
  if (!id || (!force && now - linesAt < 60_000)) return
  linesAt = now
  let items: { id: number; name: string; lamp: Lamp }[] = [],
    out: Lamp[] = [],
    has = false
  const lamp = (t: ReturnType<typeof packEcho>): Lamp => ({
    name: t.name,
    lat: t.last && !t.last.timeout && t.last.loss !== 1 ? t.last.lat : null,
    loss: t.loss,
    timeout: !!t.last && (t.last.timeout || t.last.loss === 1),
  })
  try {
    if (await hasMetricStore()) {
      const [ss, defs] = await Promise.all([
        queryMetrics(['ping.latency_ms', 'ping.loss'], { hours: 1, max: 60, uuid: id }),
        pingTasks(),
      ])
      has = probesFor(defs, id)
      const by = new Map<number, { lat: MetricPoint[]; loss: MetricPoint[] }>()
      ss.forEach(s => {
        const tid = Number(s.tags && s.tags.task_id)
        if (!Number.isFinite(tid)) return
        if (!by.has(tid)) by.set(tid, { lat: [], loss: [] })
        by.get(tid)[s.metric_key === 'ping.loss' ? 'loss' : 'lat'].push(...(s.points || []))
      })
      items = [...by.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([tid, v]) => {
          const name = (defs.find(d => Number(d.id) === tid) || {}).name || 'Task ' + tid
          return { id: tid, name, lamp: lamp(packEcho(tid, name, v.lat, v.loss, now)) }
        })
    } else {
      const d = await getJson('/api/records/ping?uuid=' + encodeURIComponent(id) + '&hours=1')
      has = (d.tasks || []).length > 0
      items = (d.tasks || []).map(t => {
        const rs = (d.records || []).filter(p => String(p.task_id) === String(t.id)),
          name = t.name || 'Task ' + t.id
        return {
          id: Number(t.id),
          name,
          lamp: lamp(
            packEcho(
              t.id,
              name,
              rs.map(p => ({ time: p.time, value: p.value })),
              rs
                .filter(p => Number.isFinite(p.value))
                .map(p => ({ time: p.time, value: p.value < 0 ? 1 : 0 })),
              now,
            ),
          ),
        }
      })
    }
    lineGroup = echoGroup()
    out =
      lineGroup === 'preset'
        ? presetRows(items, id)
            .filter(r => r.task)
            .map(r => ({ ...r.task.lamp, name: r.name }))
        : customTasks(items).map(t => t.lamp)
  } catch (e) {
    out = lines || []
    has = probed
  }
  if (id !== uuid) return
  lines = out
  probed = has
  scene.lamps = out.slice(0, 6)
  renderLegend()
}

/* ── company: a same-group idle neighbour drops by; Nanomuse visits ── */
function company(): void {
  const n = node()
  if (!n || trackOf(n.uuid).online == null) return
  const now = Date.now(),
    mood = moodOf(n.uuid, now),
    me = characterOf(n.uuid).key
  guestId = null
  if (mood === 'idle') {
    const g = (n.group || '').trim()
    const ok = visible().filter(
      x =>
        x.uuid !== n.uuid &&
        (x.group || '').trim() === g &&
        S.online.has(x.uuid) &&
        moodOf(x.uuid, now) === 'idle' &&
        characterOf(x.uuid).key !== me,
    )
    if (ok.length) guestId = ok[Math.floor(now / 600_000) % ok.length].uuid
  }
  const t = trackOf(n.uuid)
  const visit: Visit =
    mood === 'offline'
      ? 'offline'
      : mood === 'call' && t.alertSince != null && now - t.alertSince >= VISIT_AFTER
        ? 'call'
        : null
  scene.setCompany(guestId, visit)
}

/* ── text: header, legend, tooltip ── */
const shown = new Map<string, string>()
function put(id: string, html: string): void {
  if (shown.get(id) === html) return
  shown.set(id, html)
  $(id).innerHTML = html
}

function renderHead(): void {
  const n = node()
  if (!n) return
  const c = characterOf(n.uuid),
    mood = moodOf(n.uuid)
  put(
    'homeHead',
    `<div><b>${esc(n.name)} · ${esc(c.name)}的家</b><span>${esc(c.personality)} · 家里的东西都对应这台服务器的真实数据</span></div><div class="home-h-r"><em class="dp-mood m-${mood === 'call' ? 'alert' : mood}">${MOOD_LABEL[mood]}</em><a href="/duty" data-nav>去值班室 ↗</a></div>`,
  )
}

/** One line per object; also the tooltip text. */
function facts(): Record<string, [string, string]> {
  const n = node()
  if (!n) return {}
  const on = S.online.has(n.uuid),
    m = metrics(n),
    mood = moodOf(n.uuid),
    idleDo = mood === 'idle' ? activity(Date.now(), n.uuid.length, !!guestId) : null,
    snack = snackLevel(n, m),
    e = expiry(n),
    guest = guestId && S.nodes.find(x => x.uuid === guestId)
  const group = lineGroup === 'preset' ? '默认四线' : '自定义目标'
  const lineText = !lines
    ? '载入中…'
    : !lines.length
      ? probed
        ? group + '最近 1 小时没有拨测样本，灯不亮'
        : '未配置拨测，灯不亮'
      : `<small class="lamp-group">${group}</small>` +
        lines
          .map(l => {
            const tone = lampTone(l)
            return `<span class="hl-${tone}">${esc(l.name)} ${l.timeout ? '超时' : fMs(l.lat)}${l.loss ? ' · 丢包 ' + l.loss.toFixed(1) + '%' : ''}</span>`
          })
          .join('') +
        (lines.length > 6 ? '<small>只有前 6 条有灯</small>' : '')
  const who = characterOf(n.uuid).name
  const doing =
    mood === 'offline'
      ? '断电了，在沙发上睡着'
      : mood === 'call'
        ? '转过身来接领导电话'
        : mood === 'alert' || mood === 'busy'
          ? '坐在书桌前埋头苦干，冒汗'
          : mood === 'work'
            ? '坐在书桌前打字'
            : idleDo === 'out'
              ? '出门了（去洗手间或转转），书桌暂离，屏幕照常'
              : idleDo === 'snack'
                ? '在沙发上吃零食'
                : idleDo === 'game'
                  ? '在沙发上打游戏'
                  : '在沙发上看电视'
  return {
    owner: [who, doing],
    monitors: [
      '显示器',
      on
        ? `CPU ${m.cpu.toFixed(1)}% · 内存 ${m.ram.toFixed(0)}% · 磁盘 ${m.disk.toFixed(0)}% · ↑ ${fS(m.up)} ↓ ${fS(m.down)}`
        : '停电，屏幕全黑',
    ],
    lamps: ['网络面板', lineText],
    phone: ['座机', mood === 'call' ? '响个不停：CPU 持续超过告警阈值，领导来电' : '安静'],
    tv: [
      '电视',
      idleDo === 'game'
        ? '开着，在打游戏（空闲中）'
        : idleDo === 'tv'
          ? '开着，在看节目（空闲中）'
          : '关着，空闲时才开',
    ],
    plant: [
      '盆栽',
      m.uptime
        ? `已运行 ${fUp(m.uptime)} · ${PLANT_LABEL[plantStage(m.uptime)]}（重启后重新发芽）`
        : '还没发芽',
    ],
    snacks: [
      '零食柜',
      snack.used == null
        ? '未设流量配额，零食常满'
        : `流量已用 ${snack.used.toFixed(0)}% · ${SNACK_LABEL[snack.frame]}`,
    ],
    calendar: ['挂历', e.date ? e.label + (e.urgent && e.days >= 0 ? ' · 房租快到期' : '') : '没有到期日'],
    window: ['窗外', (isNight() ? '夜晚' : '白天') + '，按你的本地时间'],
    ...(guest
      ? { guest: ['串门', `${esc(guest.name)} 的${esc(characterOf(guest.uuid).name)}也闲着，来一起打游戏`] }
      : {}),
  }
}

function renderLegend(): void {
  const f = facts()
  put(
    'homeLegend',
    Object.entries(f)
      .map(([k, [label, v]]) => `<li data-k="${k}"><span>${label}</span><b>${v}</b></li>`)
      .join(''),
  )
}

const SPOT_FACT: Partial<Record<Spot, string>> = {
  'mon-cpu': 'monitors',
  'mon-mem': 'monitors',
  'mon-net': 'monitors',
  lamps: 'lamps',
  phone: 'phone',
  tv: 'tv',
  plant: 'plant',
  snacks: 'snacks',
  calendar: 'calendar',
}
function tip(spot: Spot | null, x: number, y: number): void {
  const el = $('homeTip'),
    n = node()
  let html = ''
  if (spot && SPOT_FACT[spot]) {
    const [label, v] = facts()[SPOT_FACT[spot]]
    html = `<b>${label}</b>${v}`
  } else if (spot === 'owner' && n)
    html = `<b>${esc(characterOf(n.uuid).name)}</b>${MOOD_LABEL[moodOf(n.uuid)]} · 点一下戳戳 TA`
  else if (spot === 'guest' && guestId) {
    const g = S.nodes.find(x => x.uuid === guestId)
    html = `<b>${esc(characterOf(guestId).name)}</b>来自 ${esc(g ? g.name : '')}，点一下去 TA 家`
  } else if (spot === 'muse') html = '<b>纳米缪斯</b>来家访的领导 · 点一下看待关注节点'
  if (!html) {
    el.hidden = true
    return
  }
  el.innerHTML = html
  el.hidden = false
  const wrap = el.parentElement.getBoundingClientRect(),
    w = el.offsetWidth
  el.style.left = Math.max(4, Math.min(wrap.width - w - 4, x - w / 2)) + 'px'
  el.style.top = Math.max(4, y - el.offsetHeight - 14) + 'px'
}

/* ── entry points ── */
function openHome(id: string): void {
  if (!scene) return
  if (id !== uuid) {
    uuid = id
    lines = null
    probed = false
    linesAt = 0
    guestId = null
    shown.clear()
    scene.setNode(id)
    $('homeTip').hidden = true
  }
  castNodes(visible())
  const n = node()
  $('homeCanvas').setAttribute(
    'aria-label',
    n ? `${characterOf(id).name}的家：${n.name} 的状态画面，文字版见下方清单` : '节点的家',
  )
  uHome()
  start()
  if (S._loaded) {
    seedHistory()
    loadLines(true)
    checkLoss()
  }
}

/** Live tick while the detail page is shown. */
function uHome(): void {
  const n = node()
  if (!scene || !n) return
  const m = metrics(n)
  if (S.online.has(n.uuid)) scene.pushNet(m.up, m.down)
  company()
  renderHead()
  renderLegend()
  loadLines()
}

/* Event wiring, called once from main after the views are mounted. */
function bindHome(): void {
  const canvas = $<HTMLCanvasElement>('homeCanvas')
  scene = new HomeScene(canvas)
  new ResizeObserver(() => scene.resize()).observe(canvas)
  document.addEventListener('visibilitychange', start)
  const at = (e: MouseEvent) => {
    const b = canvas.getBoundingClientRect()
    return [e.clientX - b.left, e.clientY - b.top]
  }
  canvas.addEventListener('mousemove', e => {
    const [x, y] = at(e),
      spot = scene.hit(x, y)
    canvas.style.cursor = spot === 'owner' || spot === 'guest' || spot === 'muse' ? 'pointer' : 'default'
    tip(spot, x, y)
  })
  canvas.addEventListener('mouseleave', () => ($('homeTip').hidden = true))
  canvas.addEventListener('click', e => {
    const [x, y] = at(e),
      spot = scene.hit(x, y)
    if (spot === 'owner' && uuid && S.online.has(uuid)) {
      const c = characterOf(uuid)
      scene.say('owner', c.poke[pokes++ % c.poke.length], 3000)
    } else if (spot === 'guest' && guestId) nav('/detail/' + encodeURIComponent(guestId))
    else if (spot === 'muse') nav('/')
    else tip(spot, x, y)
  })
  onDutyEvent(e => {
    if (S.page !== 'detail' || e.initial) return
    if (e.uuid === uuid) scene.say('owner', MOMENTS[e.kind].line)
    else if (e.uuid === guestId) scene.say('guest', MOMENTS[e.kind].line)
  })
}

export { bindHome, openHome, uHome }
