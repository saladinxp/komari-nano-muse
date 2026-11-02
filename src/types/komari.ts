/**
 * Komari API shapes used by the theme.
 *
 * Live data arrives nested over the /api/clients WebSocket and is flattened by
 * `flat()` (utils/metrics) into `LiveRecord`. History comes from the Komari ≥ 1.2.6
 * metric store (`MetricSeries`) or, on older servers, the legacy REST records.
 */

/** /api/nodes — node metadata. */
export interface KomariNode {
  uuid: string
  name: string
  os?: string
  cpu_name?: string
  cpu_cores?: number
  arch?: string
  virtualization?: string
  kernel_version?: string
  gpu_name?: string
  region?: string
  group?: string
  tags?: string
  mem_total?: number
  disk_total?: number
  swap_total?: number
  weight?: number
  hidden?: boolean
  /** Price per billing cycle; -1 means free. */
  price?: number
  /** Billing cycle in days (sometimes stringified by the API). */
  billing_cycle?: number | string
  currency?: string
  /** ISO date; years before 2000 mean "no expiry". */
  expired_at?: string
  /** 自动续费: Komari moves expired_at forward itself (utils/renewal). */
  auto_renewal?: boolean
  /** Traffic allowance in bytes; 0 means unlimited. */
  traffic_limit?: number
  traffic_limit_type?: 'max' | 'min' | 'sum' | 'up' | 'down' | string
}

/** Nested record as sent over the /api/clients WebSocket. */
export interface KomariRecordRaw {
  cpu?: { usage?: number }
  ram?: { used?: number; total?: number }
  swap?: { used?: number; total?: number }
  disk?: { used?: number; total?: number }
  network?: { up?: number; down?: number; totalUp?: number; totalDown?: number }
  connections?: { tcp?: number; udp?: number }
  load?: { load1?: number; load5?: number; load15?: number }
  uptime?: number
  process?: number
  updated_at?: string
}

/** One node in `common:getNodesLatestStatus` (map uuid → this), the HTTP fallback for the
    live socket. Flat names like the legacy records; bytes and bytes/s. */
export interface KomariLatestStatus {
  client?: string
  time?: string
  cpu?: number
  ram?: number
  ram_total?: number
  swap?: number
  swap_total?: number
  disk?: number
  disk_total?: number
  /** Node download / upload rate as seen by Komari (= network.down / network.up). */
  net_in?: number
  net_out?: number
  net_total_up?: number
  net_total_down?: number
  load?: number
  load5?: number
  load15?: number
  process?: number
  /** TCP + UDP. */
  connections?: number
  connections_udp?: number
  uptime?: number
  online?: boolean
}

/** Flattened live record (bytes, bytes/s, percent). */
export interface LiveRecord {
  _hasTraffic?: boolean
  _hasCpu?: boolean
  _hasMemory?: boolean
  _hasDisk?: boolean
  _hasNetwork?: boolean
  _hasSwap?: boolean
  cpu: number
  mem_used: number
  mem_total: number
  swap_used: number
  swap_total: number
  disk_used: number
  disk_total: number
  up: number
  down: number
  total_up: number
  total_down: number
  tcp: number
  udp: number
  load1: number
  load5: number
  load15: number
  uptime: number
  process: number
  updated_at: string
  /** Whether the agent actually reported these groups (absent ≠ zero). */
  _hasLoad?: boolean
  _hasConnections?: boolean
  _hasProcess?: boolean
}

/** One point of a metric-store series; null marks an empty bucket. */
export interface MetricPoint {
  time: string
  value: number | null
}

export interface MetricSeries {
  metric_key: string
  entity_id?: string
  tags?: Record<string, string>
  points: MetricPoint[]
  /** Aggregated metric timestamps mark the beginning of each bucket. */
  interval_seconds?: number
  downsampled?: boolean
}

/** Ping task definition from public:getPublicPingTasks or /api/records/ping. */
export interface PingTaskDef {
  id: number
  name: string
  type?: string
  interval?: number
  loss?: number
  /** Node UUIDs the task runs on (current Komari's public:getPublicPingTasks). */
  clients?: string[]
}

/** Theme settings configured in the Komari admin (komari-theme.json). */
export interface ThemeSettings {
  hero_title?: string
  hero_subtitle?: string
  hero_quote?: string
  brand_sub?: string
  default_mode?: 'auto' | 'light' | 'dark' | string
  visual_effects?: 'on' | 'off' | string
  background_motion?: 'on' | 'off' | string
  show_char?: 'on' | 'off' | string
  core_crew?: 'on' | 'off' | string
  char_url?: string
  char_awake_url?: string
  bg_video?: string
  bg_video_awake?: string
  bg_video_opacity?: string
  announce_text?: string
  footer_text?: string
  version_tag?: string
  alert_cpu?: string
  alert_ram?: string
  alert_disk?: string
  node_coords?: string
  [key: string]: string | undefined
}
