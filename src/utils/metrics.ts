import { S } from '../state'
import type { KomariLatestStatus, KomariNode, KomariRecordRaw, LiveRecord } from '../types/komari'
import { pct } from './format'

/* flatten a nested WS / recent record */
function flat(r: KomariRecordRaw | LiveRecord): LiveRecord {
  if (!r || typeof r !== 'object') return r as LiveRecord
  if (typeof r.cpu === 'number') return r as LiveRecord
  const raw = r as KomariRecordRaw
  return {
    _hasCpu: typeof raw.cpu?.usage === 'number' && Number.isFinite(raw.cpu.usage),
    _hasMemory: typeof raw.ram?.used === 'number' && Number.isFinite(raw.ram.used),
    _hasDisk: typeof raw.disk?.used === 'number' && Number.isFinite(raw.disk.used),
    _hasNetwork: [raw.network?.up, raw.network?.down].every(v => typeof v === 'number' && Number.isFinite(v)),
    _hasSwap: typeof raw.swap?.used === 'number' && Number.isFinite(raw.swap.used),
    _hasTraffic:
      !!raw.network &&
      [raw.network.totalUp, raw.network.totalDown].every(
        v => typeof v === 'number' && Number.isFinite(v) && v >= 0,
      ),
    _hasLoad:
      !!raw.load &&
      [raw.load.load1, raw.load.load5, raw.load.load15].every(
        v => typeof v === 'number' && Number.isFinite(v),
      ),
    _hasConnections:
      !!raw.connections &&
      [raw.connections.tcp, raw.connections.udp].every(v => typeof v === 'number' && Number.isFinite(v)),
    _hasProcess: typeof raw.process === 'number' && Number.isFinite(raw.process),
    cpu: (raw.cpu && raw.cpu.usage) || 0,
    mem_used: (raw.ram && raw.ram.used) || 0,
    mem_total: (raw.ram && raw.ram.total) || 0,
    swap_used: (raw.swap && raw.swap.used) || 0,
    swap_total: (raw.swap && raw.swap.total) || 0,
    disk_used: (raw.disk && raw.disk.used) || 0,
    disk_total: (raw.disk && raw.disk.total) || 0,
    up: (raw.network && raw.network.up) || 0,
    down: (raw.network && raw.network.down) || 0,
    total_up: (raw.network && raw.network.totalUp) || 0,
    total_down: (raw.network && raw.network.totalDown) || 0,
    tcp: (raw.connections && raw.connections.tcp) || 0,
    udp: (raw.connections && raw.connections.udp) || 0,
    load1: (raw.load && raw.load.load1) || 0,
    load5: (raw.load && raw.load.load5) || 0,
    load15: (raw.load && raw.load.load15) || 0,
    uptime: raw.uptime || 0,
    process: raw.process || 0,
    updated_at: raw.updated_at || '',
  }
}
/** One entry of the `common:getNodesLatestStatus` RPC (the HTTP fallback when the live socket
    cannot open) → the same LiveRecord a socket frame gives. Komari names the rates from the
    server's side there (`net_in` = the node's download) and counts UDP inside `connections`. */
function fromLatest(r: KomariLatestStatus): LiveRecord {
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0),
    udp = n(r.connections_udp)
  return {
    _hasCpu: typeof r.cpu === 'number' && Number.isFinite(r.cpu),
    _hasMemory: typeof r.ram === 'number' && Number.isFinite(r.ram),
    _hasDisk: typeof r.disk === 'number' && Number.isFinite(r.disk),
    _hasNetwork: [r.net_in, r.net_out].every(v => typeof v === 'number' && Number.isFinite(v)),
    _hasSwap: typeof r.swap === 'number' && Number.isFinite(r.swap),
    _hasTraffic: [r.net_total_up, r.net_total_down].every(
      v => typeof v === 'number' && Number.isFinite(v) && v >= 0,
    ),
    _hasLoad: [r.load, r.load5, r.load15].every(v => typeof v === 'number' && Number.isFinite(v)),
    _hasConnections: [r.connections, r.connections_udp].every(
      v => typeof v === 'number' && Number.isFinite(v),
    ),
    _hasProcess: typeof r.process === 'number' && Number.isFinite(r.process),
    cpu: n(r.cpu),
    mem_used: n(r.ram),
    mem_total: n(r.ram_total),
    swap_used: n(r.swap),
    swap_total: n(r.swap_total),
    disk_used: n(r.disk),
    disk_total: n(r.disk_total),
    up: n(r.net_out),
    down: n(r.net_in),
    total_up: n(r.net_total_up),
    total_down: n(r.net_total_down),
    tcp: Math.max(0, n(r.connections) - udp),
    udp,
    load1: n(r.load),
    load5: n(r.load5),
    load15: n(r.load15),
    uptime: n(r.uptime),
    process: n(r.process),
    updated_at: typeof r.time === 'string' ? r.time : '',
  }
}
function metrics(n: KomariNode) {
  const l: Partial<LiveRecord> = S.live[n.uuid] || {}
  const memT = l.mem_total || n.mem_total || 0,
    diskT = l.disk_total || n.disk_total || 0
  return {
    hasCpu: l._hasCpu ?? Number.isFinite(l.cpu),
    hasMemory: (l._hasMemory ?? Number.isFinite(l.mem_used)) && memT > 0,
    hasDisk: (l._hasDisk ?? Number.isFinite(l.disk_used)) && diskT > 0,
    hasNetwork: l._hasNetwork ?? [l.up, l.down].every(v => typeof v === 'number' && Number.isFinite(v)),
    hasSwap: l._hasSwap ?? Number.isFinite(l.swap_used),
    hasLoad: l._hasLoad ?? [l.load1, l.load5, l.load15].some(x => typeof x === 'number'),
    hasConnections: l._hasConnections ?? [l.tcp, l.udp].some(x => typeof x === 'number'),
    hasProcess: l._hasProcess ?? typeof l.process === 'number',
    cpu: l.cpu || 0,
    ram: pct(l.mem_used || 0, memT),
    disk: pct(l.disk_used || 0, diskT),
    memU: l.mem_used || 0,
    memT,
    diskU: l.disk_used || 0,
    diskT,
    swapU: l.swap_used || 0,
    swapT: l.swap_total || n.swap_total || 0,
    up: l.up || 0,
    down: l.down || 0,
    tu: l.total_up || 0,
    td: l.total_down || 0,
    tcp: l.tcp || 0,
    udp: l.udp || 0,
    proc: l.process || 0,
    uptime: l.uptime || 0,
    load1: l.load1 || 0,
    load5: l.load5 || 0,
    load15: l.load15 || 0,
    at: l.updated_at,
  }
}
function trafficUsed(n, m) {
  const t = (n.traffic_limit_type || 'max').toLowerCase()
  if (t === 'sum') return m.tu + m.td
  if (t === 'up') return m.tu
  if (t === 'down') return m.td
  if (t === 'min') return Math.min(m.tu, m.td)
  return Math.max(m.tu, m.td)
}

export { flat, fromLatest, metrics, trafficUsed }
