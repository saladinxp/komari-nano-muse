/* Offline preview only: route by hash and inline the artwork before the app boots. */
import sleep from '../public/char-sleep-cutout.webp?inline'
import awake from '../public/char-awake-cutout.webp?inline'
import fallback from '../public/char.png?inline'
import { SCENE_ART } from './cast/art'
import { ASSETS } from './state'

window.__NM_HASH_ROUTER__ = true
Object.assign(ASSETS, { sleep, awake, fallback })

/* Duty-room artwork (public/scene-art/*.webp) inlined under its file name. */
const duty = import.meta.glob<string>('../public/scene-art/*.webp', {
  query: '?inline',
  import: 'default',
  eager: true,
})
Object.entries(duty).forEach(([path, uri]) => (SCENE_ART[path.replace(/^.*\/|\.webp$/g, '')] = uri))
