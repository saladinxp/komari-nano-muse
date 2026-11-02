/* 值班室 page: rooms on the floor, the canvas scene, the selected worker, the
   roster, the duty log and the moment book.

   The animation loop only runs while this page is shown and the tab is visible.
   Artwork is requested by the scene on first draw (assets.ts). */
import { S, visible } from '../../state'
import type { KomariNode } from '../../types/komari'
import { nav } from '../../router'
import { $, esc, fClock, fS, fUp, store } from '../../utils/format'
import { metrics } from '../../utils/metrics'
import { art, onArt } from '../../cast/art'
import { MOOD_LABEL, type Mood, moodOf } from '../../cast/behavior'
import { seedHistory } from '../../cast/history'
import { checkLoss, discovered, dutyLog, MOMENTS, type MomentKind, onDutyEvent } from '../../cast/events'
import { buildRooms, type Room } from './layout'
import { ATLASES, CHARACTERS, type Character, castNodes, characterOf, setCharacter } from '../../cast/roster'
import { DutyScene } from './scene'

let scene: DutyScene | null = null
let rooms: Room[] = []
let roomId = store.get('duty-room', '')
let signature = ''
let raf = 0
let lastDraw = 0
let pokes = 0

const room = (): Room | undefined => rooms.find(r => r.id === roomId) || rooms[0]
const motionOff = () =>
  document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches

/* ── rooms ── */
function rebuild(): void {
  const vis = visible(),
    sig = vis.map(n => n.uuid + '|' + (n.group || '')).join(',')
  if (sig === signature && rooms.length) return
  signature = sig
  castNodes(vis)
  rooms = buildRooms(vis)
  showRoom(room()?.id || '')
}

function showRoom(id: string): void {
  const r = rooms.find(x => x.id === id) || rooms[0]
  if (!r) return
  roomId = r.id
  store.set('duty-room', roomId)
  if (scene.selected && !r.nodes.some(n => n.uuid === scene.selected)) scene.selected = null
  scene.setRoom(r)
  art(r.type.day)
  art(r.type.night)
  renderAll()
}

/* ── loop ── */
function frame(now: number): void {
  raf = 0
  if (S.page !== 'duty' || document.hidden) return
  scene.reduced = motionOff()
  if (now - lastDraw >= (scene.reduced ? 500 : 33)) {
    lastDraw = now
    scene.draw(now)
  }
  raf = requestAnimationFrame(frame)
}
function start(): void {
  if (!raf && S.page === 'duty' && !document.hidden) raf = requestAnimationFrame(frame)
}

/* ── portraits: the head of each idle frame, cut once its atlas has loaded ── */
const portraits = new Map<string, string>()
function portrait(c: Character): string {
  if (portraits.has(c.key)) return portraits.get(c.key)
  const a = ATLASES[c.atlas],
    sheet = art(a.art)
  if (!sheet.ready) return ''
  const [x, y, w] = c.frames.idle,
    s = a.scale,
    cv = document.createElement('canvas')
  cv.width = cv.height = 96
  cv.getContext('2d').drawImage(sheet.img, x * s, y * s, w * s, w * s, 0, 0, 96, 96)
  const url = cv.toDataURL('image/webp', 0.85)
  portraits.set(c.key, url)
  return url
}
const face = (c: Character, cls = 'duty-face') => {
  const src = portrait(c)
  return src
    ? `<img class="${cls}" src="${src}" alt="" />`
    : `<span class="${cls}" style="background:${c.color}"></span>`
}

/* ── panels ── */
/* Live ticks re-render every 2.5 s; only touch the DOM when the markup changed,
   so focus and hover survive. */
const shown = new Map<string, string>()
function put(id: string, html: string): void {
  if (shown.get(id) === html) return
  shown.set(id, html)
  $(id).innerHTML = html
}
const MOOD_ORDER: Mood[] = ['offline', 'call', 'alert', 'busy', 'idle', 'work']
const moodCls = (m: Mood) => 'm-' + (m === 'call' ? 'alert' : m)

function renderFloor(): void {
  const cur = room()
  put(
    'dutyFloor',
    rooms
      .map(r => {
        const dots = r.nodes.map(n => `<i class="${moodCls(moodOf(n.uuid))}"></i>`).join('')
        const on = r.nodes.filter(n => S.online.has(n.uuid)).length
        return `<button role="tab" data-room="${esc(r.id)}" aria-selected="${r === cur}" class="${r === cur ? 'on' : ''}"><span class="df-name">${esc(r.title)}${r.part ? ` <small>${r.part}</small>` : ''}</span><span class="df-meta">${on}/${r.nodes.length} 在岗 · ${esc(r.type.name)}</span><span class="df-dots">${dots}</span></button>`
      })
      .join(''),
  )
  $('dutyFloor').hidden = rooms.length < 2
}

function renderHead(): void {
  const r = room()
  if (!r) return
  const n = r.nodes.length,
    on = r.nodes.filter(x => S.online.has(x.uuid)).length,
    empty = r.type.capacity - n
  $('dutyRoomName').textContent = r.title + (r.part ? ' ' + r.part : '')
  $('dutyRoomMeta').textContent =
    `${r.type.name} · ${r.type.capacity} 工位 · ${on}/${n} 在岗${empty ? ' · 空位 ' + empty : ''}`
  $('dutyCanvas').setAttribute(
    'aria-label',
    `${r.title}，${r.type.name}，${r.type.capacity} 个工位，${n} 台节点，${on} 台在线，${empty} 个空位。文字版见右侧工位表。`,
  )
}

function renderPick(): void {
  const r = room(),
    n = r && r.nodes.find(x => x.uuid === scene.selected)
  if (!n) {
    const counts = new Map<Mood, number>()
    ;(r?.nodes || []).forEach(x => counts.set(moodOf(x.uuid), (counts.get(moodOf(x.uuid)) || 0) + 1))
    put(
      'dutyPick',
      r?.nodes.length
        ? `<div class="duty-h"><h3>本房间</h3><span>OVERVIEW</span></div><div class="dp-moods">${MOOD_ORDER.filter(
            m => counts.get(m),
          )
            .map(
              m =>
                `<span class="${moodCls(m)}"><i></i>${MOOD_LABEL[m]}<b class="num">${counts.get(m)}</b></span>`,
            )
            .join('')}</div><p class="dp-hint">点画面里的值班员，或从工位表里选一位。</p>`
        : `<div class="duty-h"><h3>本房间</h3><span>OVERVIEW</span></div><p class="dp-hint">还没有节点，值班室空着。</p>`,
    )
    return
  }
  const c = characterOf(n.uuid),
    mood = moodOf(n.uuid),
    on = S.online.has(n.uuid),
    m = metrics(n)
  const stat = (k: string, v: string) => `<div><span>${k}</span><b class="num">${v}</b></div>`
  put(
    'dutyPick',
    `<div class="dp-top">${face(c, 'duty-face lg')}<div class="dp-id"><b>${esc(n.name)}</b><span>${esc(c.name)} · ${esc(c.personality)}</span></div><em class="dp-mood ${moodCls(mood)}">${MOOD_LABEL[mood]}</em></div>` +
      (on
        ? `<div class="dp-stats">${stat('CPU', m.cpu.toFixed(1) + '%')}${stat('内存', m.ram.toFixed(1) + '%')}${stat('磁盘', m.disk.toFixed(1) + '%')}${stat('上行', fS(m.up))}${stat('下行', fS(m.down))}${stat('运行', fUp(m.uptime))}</div>`
        : `<p class="dp-hint">节点离线，工位熄屏。恢复在线后 ${esc(c.name)} 会自己醒来。</p>`) +
      `<q class="dp-quote">${esc(c.quote)}</q><a class="dp-link" href="/detail/${encodeURIComponent(n.uuid)}" data-nav>查看节点详情 ↗</a>` +
      `<div class="dp-cast-h">换个搭档 <small>只改外观，不影响节点数据</small></div><div class="dp-cast">${CHARACTERS.map(
        x =>
          `<button data-cast="${x.key}" class="${x.key === c.key ? 'on' : ''}" title="${esc(x.name + ' · ' + x.personality)}" aria-label="换成${esc(x.name)}" aria-pressed="${x.key === c.key}">${face(x)}<span>${esc(x.name)}</span></button>`,
      ).join('')}</div>`,
  )
}

function renderRoster(): void {
  const r = room()
  put(
    'dutyRoster',
    (r?.nodes || [])
      .map((n: KomariNode, i) => {
        const c = characterOf(n.uuid),
          mood = moodOf(n.uuid)
        return `<li><button data-pick="${esc(n.uuid)}" class="${moodCls(mood)}${n.uuid === scene.selected ? ' on' : ''}"><span class="dr-desk num">${String(i + 1).padStart(2, '0')}</span><i></i><span class="dr-name">${esc(n.name)}</span><span class="dr-who">${esc(c.name)}</span><span class="dr-mood">${MOOD_LABEL[mood]}</span></button></li>`
      })
      .join(''),
  )
}

function renderLog(): void {
  const log = dutyLog()
  put(
    'dutyLog',
    log.length
      ? log
          .slice(0, 24)
          .map(
            e =>
              `<li><button data-pick="${esc(e.uuid)}" data-any-room><time class="num">${fClock(new Date(e.at))}</time><span class="dl-kind">${MOMENTS[e.kind].title}</span><span class="dl-text">${esc(e.text)}</span></button></li>`,
          )
          .join('')
      : '<li class="dl-empty">一切平静。掉线、冲高、重启这些真实事件发生时会记在这里。</li>',
  )
}

function renderBook(): void {
  const f = discovered(),
    kinds = Object.keys(MOMENTS) as MomentKind[],
    got = kinds.filter(k => f[k]).length
  $('dutyBookCount').textContent = got + ' / ' + kinds.length
  put(
    'dutyBook',
    kinds
      .map(k => {
        const d = f[k],
          mo = MOMENTS[k]
        return d
          ? `<div class="db-item got"><b>${mo.title}</b><span>“${esc(mo.line)}”</span><em>${mo.hint} · ${d.count} 次</em></div>`
          : `<div class="db-item"><b>？？？</b><span>${mo.hint}</span><em>尚未发现</em></div>`
      })
      .join(''),
  )
}

function renderAll(): void {
  renderFloor()
  renderHead()
  renderPick()
  renderRoster()
  renderLog()
  renderBook()
}

/* ── selection ── */
function select(uuid: string | null): void {
  if (uuid && uuid === scene.selected) {
    const c = characterOf(uuid)
    if (S.online.has(uuid)) scene.say(uuid, c.poke[pokes++ % c.poke.length], 3000)
  }
  scene.selected = uuid
  renderPick()
  renderRoster()
}

/* ── entry points ── */
function openDuty(): void {
  if (!scene) return
  rebuild()
  renderAll()
  start()
  if (S._loaded) {
    seedHistory()
    checkLoss().then(() => S.page === 'duty' && renderLog())
  }
}

/** Live tick while the page is shown. */
function uDuty(): void {
  if (!scene) return
  rebuild()
  renderFloor()
  renderHead()
  renderPick()
  renderRoster()
  checkLoss()
}

/* Event wiring, called once from main after the views are mounted. */
function bindDuty(): void {
  scene = new DutyScene($<HTMLCanvasElement>('dutyCanvas'))
  new ResizeObserver(() => scene.resize()).observe(scene.canvas)
  document.addEventListener('visibilitychange', start)
  onArt(() => {
    if (S.page !== 'duty') return
    if (portraits.size < CHARACTERS.length) {
      renderPick()
    }
  })
  onDutyEvent(e => {
    if (!e.initial) scene.say(e.uuid, MOMENTS[e.kind].line)
    if (S.page === 'duty') {
      renderLog()
      renderBook()
    }
  })
  /* hover: which server, who, doing what */
  scene.canvas.addEventListener('mousemove', e => {
    const b = scene.canvas.getBoundingClientRect(),
      x = e.clientX - b.left,
      y = e.clientY - b.top,
      h = scene.hit(x, y),
      tip = $('dutyTip'),
      n = h && h.uuid && S.nodes.find(v => v.uuid === h.uuid)
    scene.canvas.style.cursor = n || h?.muse ? 'pointer' : 'default'
    if (h?.muse) {
      tip.innerHTML = '<b>纳米缪斯</b>正在巡视 · 点一下看需要关注的节点'
      tip.hidden = false
      const w = tip.offsetWidth
      tip.style.left = Math.max(4, Math.min(b.width - w - 4, x - w / 2)) + 'px'
      tip.style.top = Math.max(4, y - tip.offsetHeight - 14) + 'px'
      return
    }
    if (!n) {
      tip.hidden = true
      return
    }
    const c = characterOf(n.uuid),
      at = scene.where(n.uuid)
    tip.innerHTML = `<b>${esc(n.name)}</b>${esc(c.name)} · ${MOOD_LABEL[moodOf(n.uuid)]}${at === 'out' ? ' · 去洗手间了' : at === 'chat' ? ' · 串门聊天中' : at === 'away' ? ' · 暂离工位' : ''}`
    tip.hidden = false
    const w = tip.offsetWidth
    tip.style.left = Math.max(4, Math.min(b.width - w - 4, x - w / 2)) + 'px'
    tip.style.top = Math.max(4, y - tip.offsetHeight - 14) + 'px'
  })
  scene.canvas.addEventListener('mouseleave', () => ($('dutyTip').hidden = true))
  scene.canvas.addEventListener('click', e => {
    const b = scene.canvas.getBoundingClientRect(),
      h = scene.hit(e.clientX - b.left, e.clientY - b.top)
    if (h?.muse) {
      /* her notebook: the dashboard filtered to nodes that need attention */
      nav('/')
      $('attentionBtn').click()
      return
    }
    select(h ? h.uuid : null)
  })
  $('dutyFloor').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-room]')
    if (b) showRoom(b.dataset.room)
  })
  const pick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]')
    if (!b) return
    const uuid = b.dataset.pick
    if (!room()?.nodes.some(n => n.uuid === uuid)) {
      const r = rooms.find(x => x.nodes.some(n => n.uuid === uuid))
      if (!r) return
      showRoom(r.id)
    }
    select(uuid)
    if (b.hasAttribute('data-any-room')) scene.canvas.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  $('dutyRoster').addEventListener('click', pick)
  $('dutyLog').addEventListener('click', pick)
  $('dutyPick').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cast]')
    if (!b || !scene.selected) return
    setCharacter(scene.selected, b.dataset.cast)
    scene.say(scene.selected, characterOf(scene.selected).quote, 3500)
    renderPick()
    renderRoster()
  })
}

/** Where a worker is in the open room (for the preview's checks). */
const dutyWhere = (uuid: string) => (scene ? scene.where(uuid) : null)
const dutySeatsForQA = () => (scene ? scene.seatsForQA() : [])

export { bindDuty, dutyWhere, dutySeatsForQA, openDuty, uDuty }
