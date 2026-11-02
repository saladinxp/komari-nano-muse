/* Scene artwork (duty room, home office, optional Stellar Core duty presence) is loaded on
   demand. Compact cards and Echo do not fetch it. Files live in
   public/scene-art/ (built by scripts/scene-art.py); the offline preview replaces
   the URLs with inlined data URIs (src/preview-setup.ts). */

/** Artwork key → URL. Keys match the file names in public/scene-art/ without ".webp". */
export const SCENE_ART: Record<string, string> = {}
const url = (key: string) => SCENE_ART[key] || '/scene-art/' + key + '.webp'

interface Slot {
  img: HTMLImageElement
  ready: boolean
  failed: boolean
}
const cache = new Map<string, Slot>()
const waiting = new Set<() => void>()

/** The image for `key`, starting the download on first use. Check `ready` before drawing. */
export function art(key: string): Slot {
  let s = cache.get(key)
  if (!s) {
    const img = new Image()
    img.decoding = 'async'
    s = { img, ready: false, failed: false }
    const slot = s
    img.onload = () => {
      slot.ready = true
      waiting.forEach(fn => fn())
    }
    img.onerror = () => {
      slot.failed = true
      waiting.forEach(fn => fn())
    }
    img.src = url(key)
    cache.set(key, s)
  }
  return s
}

/** Called whenever any artwork finishes (or fails) loading. */
export function onArt(fn: () => void): void {
  waiting.add(fn)
}
