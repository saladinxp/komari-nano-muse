import { uChar } from '../hero/settings'
import { rSummary } from '../hero/summary'
import { rNodes, uNodes } from '../nodes/list'
import { rBilling } from '../pages/billing'
import { uDuty } from '../pages/duty'
import { observe } from '../cast/events'
import { rTraffic } from '../pages/traffic'
import { uDetail } from '../pages/detail'
import { rStab } from '../pages/stability'
import { rMap } from '../pages/worldmap'
import { S } from '../state'
import type { KomariLatestStatus, LiveRecord } from '../types/komari'
import { $ } from '../utils/format'
import { flat, fromLatest } from '../utils/metrics'
import { rpc2 } from './client'

/* ── live data ──
   Normally the /api/clients WebSocket, asked for a frame every 2.5 s.
   Komari only accepts that socket when the page's Origin matches the Host header it receives,
   so behind a reverse proxy that rewrites Host or drops the upgrade the socket never opens.
   Then the page polls `common:getNodesLatestStatus` (guest-readable RPC) over plain HTTP, and
   keeps trying the socket now and then; the first socket that opens takes over again. */
const FRAME_MS = 2500
/** An open socket that leaves a request unanswered this long is treated as dead (a proxy
    holding it). Measured from the first unanswered ask, so throttled background tabs, whose
    timers fire once a minute, do not count as silence. */
const SILENT_MS = 15000
const POLL_MS = 3000
const POLL_HIDDEN_MS = 15000
/** While the fallback works, the socket is retried this rarely (each try logs a browser error). */
const WS_RETRY_POLLING_MS = 120000

function connect() {
  let ws: WebSocket,
    opened = false,
    unanswered = 0
  try {
    ws = new WebSocket(
      (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/api/clients',
    )
  } catch (e) {
    startPoll()
    return retry()
  }
  S.ws = ws
  ws.onopen = () => {
    opened = true
    S.wsTries = 0
    stopPoll()
    S.liveVia = 'ws'
    setLive(true)
    const ask = () => {
      if (ws.readyState !== 1) return
      if (unanswered && Date.now() - unanswered > SILENT_MS) return ws.close()
      unanswered = unanswered || Date.now()
      ws.send('get')
    }
    ask()
    clearInterval(S._poll)
    S._poll = setInterval(ask, FRAME_MS)
  }
  ws.onmessage = e => {
    unanswered = 0
    let m
    try {
      m = JSON.parse(e.data)
    } catch (er) {
      return
    }
    const p =
      m && m.status === 'success' && m.data
        ? m.data
        : Array.isArray(m && m.online)
          ? m
          : m && m.data && Array.isArray(m.data.online)
            ? m.data
            : null
    if (!p) return
    const data: Record<string, LiveRecord> = {}
    if (p.data) for (const k in p.data) data[k] = flat(p.data[k])
    apply(p.online || [], data)
  }
  ws.onclose = () => {
    clearInterval(S._poll)
    if (S.ws === ws) S.ws = null
    /* A socket that never opened points at the proxy / Origin check, not a passing hiccup. */
    if (!opened) startPoll()
    if (S.liveVia === 'ws') S.liveVia = null
    if (S.liveVia !== 'poll') setLive(false)
    retry()
  }
  ws.onerror = () => {
    try {
      ws.close()
    } catch (e) {}
  }
}
function retry() {
  if (S._rt) return
  const wait = S.liveVia === 'poll' ? WS_RETRY_POLLING_MS : Math.min(2000 * Math.pow(1.5, S.wsTries), 30000)
  S._rt = setTimeout(() => {
    S._rt = null
    S.wsTries++
    connect()
  }, wait)
}

/* ── HTTP fallback ── */
let polling = false,
  pollFails = 0,
  /** Komari answered 403: the proxy rewrote Host, so it refuses every request carrying an Origin. */
  pollDenied = false,
  pollTimer: ReturnType<typeof setTimeout> | null = null
function startPoll() {
  if (polling) return
  polling = true
  pollFails = 0
  pollOnce()
}
function stopPoll() {
  polling = false
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}
async function pollOnce() {
  pollTimer = null
  try {
    const r = await rpc2('common:getNodesLatestStatus', {})
    if (!polling) return
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('getNodesLatestStatus: no map')
    const online: string[] = [],
      data: Record<string, LiveRecord> = {}
    for (const k in r) {
      const x = r[k] as KomariLatestStatus
      if (!x || typeof x !== 'object') continue
      data[k] = fromLatest(x)
      if (x.online) online.push(k)
    }
    pollFails = 0
    pollDenied = false
    if (S.liveVia !== 'poll') {
      S.liveVia = 'poll'
      setLive(true)
    }
    apply(online, data)
  } catch (e) {
    if (!polling) return
    /* An older Komari without this method, the server unreachable, or a Host-rewriting proxy. */
    pollFails++
    const denied = /\b403\b/.test(String(e && e.message))
    if (S.liveVia === 'poll' || denied !== pollDenied) {
      pollDenied = denied
      if (S.liveVia === 'poll') S.liveVia = null
      setLive(false)
    }
  }
  if (!polling) return
  const wait =
    document.visibilityState === 'hidden'
      ? POLL_HIDDEN_MS
      : pollFails
        ? Math.min(POLL_MS * Math.pow(2, pollFails), 30000)
        : POLL_MS
  pollTimer = setTimeout(pollOnce, wait)
}

/** Komari leaves nodes that have not reported since it started out of both sources: they
    stay absent from `online` (offline) and keep whatever record they had. */
function apply(online: string[], data: Record<string, LiveRecord>) {
  const first = !S.lastSync,
    prev = [...S.online].sort().join()
  S.online = new Set(online)
  for (const k in data) S.live[k] = data[k]
  S.lastSync = new Date()
  onLive(first || prev !== [...S.online].sort().join())
}
function setLive(ok: boolean) {
  S.connected = ok
  document.documentElement.dataset.connection = ok ? 'live' : 'stale'
  const l = $('live'),
    poll = ok && S.liveVia === 'poll'
  l.classList.toggle('ok', ok)
  l.classList.toggle('bad', !ok)
  $('liveTxt').textContent = !ok ? '正在重连' : poll ? '轮询更新' : '实时连接'
  l.title = poll
    ? 'WebSocket 连不上（常见于反向代理没转发 Upgrade 头），已改用 HTTP 每 3 秒刷新；数据照常更新'
    : !ok && pollDenied
      ? 'Komari 拒绝了这个页面的请求（403）：反向代理很可能改写了 Host 头。请在反代里加 proxy_set_header Host $host;'
      : ''
  rSummary()
}
function onLive(statusChanged) {
  observe()
  rSummary()
  if (S.page === 'dashboard') {
    statusChanged ? rNodes() : uNodes()
  }
  if (S.page === 'duty') uDuty()
  if (S.page === 'detail') uDetail()
  if (S.page === 'worldmap' && statusChanged) rMap()
  if (S.page === 'stability' && statusChanged) rStab()
  if (S.page === 'billing' && statusChanged) rBilling()
  if (S.page === 'traffic') rTraffic()
  uChar(false)
}

export { connect, setLive }
