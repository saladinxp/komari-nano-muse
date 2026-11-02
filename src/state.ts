import type { AppState, NodeView } from './types/state'
import type { KomariNode } from './types/komari'
import { store } from './utils/format'

/* Built-in artwork. The offline preview replaces these with inlined data URIs. */
const ASSETS = { sleep: '/char-sleep-cutout.webp', awake: '/char-awake-cutout.webp', fallback: '/char.png' }
/* The offline preview runs from file:// and routes with location.hash. */
const HASH_ROUTER = () => !!window.__NM_HASH_ROUTER__
const VERSION = 'v2.1.0'

/* ── state ── */
const VIEWS: Record<string, NodeView> = { card: 'large', large: 'large', medium: 'medium', list: 'list' }
const S: AppState = {
  site: 'Komari',
  ts: {},
  nodes: [],
  live: {},
  online: new Set(),
  loggedIn: false,
  group: store.get('group', 'ALL'),
  view: VIEWS[store.get('view', 'medium')] || 'medium',
  q: '',
  status: 'all',
  connected: false,
  liveVia: null,
  lastSync: null,
  ws: null,
  wsTries: 0,
  recordHours: 720,
  pingHours: 720,
  fleetCpu: null,
  fleetAvg: null,
  det: { uuid: null, tab: 'load', hours: 6 },
  stab: { hours: 24, task: null, tasks: [], cache: {} },
  bill: store.get('billSort', 'exp'),
  echo: { entries: {}, pending: null, epoch: 0 },
  page: 'dashboard',
}
window.NM = S
const visible = (): KomariNode[] => S.nodes.filter(n => !n.hidden || S.loggedIn)
const thr = (k: 'cpu' | 'ram' | 'disk'): number => {
  const v = parseFloat(S.ts['alert_' + k])
  return isFinite(v) && v > 0 ? v : { cpu: 80, ram: 80, disk: 90 }[k]
}

export { ASSETS, HASH_ROUTER, S, VERSION, thr, visible }
