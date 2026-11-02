/* Where the Echo default targets are, for the Star Map arcs.
   Keyed by target IPv4 so the map follows whatever ECHO_PRESETS (or the
   administrator's saved targets) currently point at. A target missing here has
   no known place: the map then draws dots only and says so, instead of guessing.
   When the default province changes, add its targets here; drawing code stays as is.

   The three 2.1.0-beta.5 defaults are Hebei CDN addresses chosen by the user on
   2026-11-01. The point is the provincial capital (Shijiazhuang), a province-level
   approximation for a schematic arc, not a measured server location. */
import type { LatLng } from './places'

export interface EchoSite {
  /** Short place name shown on the map and in cards, e.g. 河北. */
  name: string
  at: LatLng
}

const HEBEI: EchoSite = { name: '河北', at: [38.04, 114.51] }

export const ECHO_SITES: Record<string, EchoSite> = {
  '124.237.177.164': HEBEI, // 电信 · 河北
  '110.242.74.102': HEBEI, // 联通 · 河北
  '111.63.65.247': HEBEI, // 移动 · 河北
}

/** Preset keys whose targets the arcs summarise (the domestic carriers, not Google). */
export const DOMESTIC_PRESET_KEYS = ['telecom', 'unicom', 'mobile'] as const
