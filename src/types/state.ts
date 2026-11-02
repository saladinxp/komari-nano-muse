import type { KomariNode, LiveRecord, ThemeSettings } from './komari'

export type Page = 'dashboard' | 'duty' | 'detail' | 'stability' | 'worldmap' | 'billing' | 'traffic'
export type NodeView = 'large' | 'medium' | 'list'

/** Per-node probe summary shown by the Echo view. */
export interface EchoEntry {
  at: number
  configured?: boolean
  error?: boolean
  tasks: any[]
}

/** Stability matrix rows cached per time window. */
export interface StabilityCache {
  at: number
  rows: Record<string, Record<number, { lat: (number | null)[]; loss: (number | null)[] }>>
  tasks: { id: number; name: string }[]
}

/** The single mutable application state shared by every module. */
export interface AppState {
  site: string
  ts: ThemeSettings
  nodes: KomariNode[]
  live: Record<string, LiveRecord>
  online: Set<string>
  loggedIn: boolean
  group: string
  view: NodeView
  q: string
  status: string
  connected: boolean
  /** How live data currently arrives: the socket, or the HTTP fallback when it cannot open. */
  liveVia: 'ws' | 'poll' | null
  lastSync: Date | null
  ws: WebSocket | null
  wsTries: number
  recordHours: number
  pingHours: number
  /** Fleet mean CPU per 15-minute bucket over 24 h. */
  fleetCpu: (number | null)[] | null
  fleetAvg: number | null
  /** 'all' when every visible node contributed, 'sample' on the legacy path. */
  fleetSource?: 'all' | 'sample'
  fleetSample?: number
  det: { uuid: string | null; tab: 'load' | 'ping' | string; hours: number }
  stab: {
    hours: number
    task: number | null
    tasks: { id: number; name: string }[]
    cache: Record<number, StabilityCache>
  }
  bill: string
  /** `pending` is an identity token for the in-flight load, so late results can be discarded. */
  echo: { entries: Record<string, EchoEntry>; pending: object | null; epoch: number }
  page: Page
  /* internal bookkeeping */
  _loaded?: boolean
  _historyDone?: boolean
  _charSt?: string
  _detTok?: number
  _watchSignature?: string
  _rt?: ReturnType<typeof setTimeout> | null
  _poll?: ReturnType<typeof setInterval>
}
