import avatar from '../views/brand-avatar.svg?raw'

export const brandAvatar = (): string => avatar

const TITLE_GLYPHS = new Set('纳米核心缪斯')
/* Fall back for the whole title, rather than combining a bundled CJK subset
   with a different system font in the same wordmark. No remote font request. */
export function needsSystemTitle(title: string): boolean {
  return Array.from(title).some(
    char => char.codePointAt(0)! > 127 && /\p{Letter}/u.test(char) && !TITLE_GLYPHS.has(char),
  )
}

/* A single ribbon N and a small signal star; unique SVG IDs per instance. */
export function brandEmblem(scope: 'header' | 'hero'): string {
  const id = `nm-${scope}`
  return `<svg class="muse-emblem" viewBox="0 0 80 80" fill="none" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${id}" x1="14" y1="14" x2="62" y2="65" gradientUnits="userSpaceOnUse">
      <stop stop-color="var(--identity-violet)"/><stop offset=".6" stop-color="var(--identity-violet)"/><stop offset="1" stop-color="var(--identity-ice)"/>
    </linearGradient></defs>
    <path d="M15 61 29 19h9L24 61Z" fill="url(#${id})"/>
    <path d="m29 19 8 0 15 35-8 7Z" fill="url(#${id})"/>
    <path d="m44 61 14-42h8L52 61Z" fill="url(#${id})"/>
    <path d="M9 57c8 8 43-1 60-19" stroke="var(--identity-ice)" stroke-width="1.2"/>
    <path d="m64 7 1.8 7.2L73 16l-7.2 1.8L64 25l-1.8-7.2L55 16l7.2-1.8Z" fill="var(--identity-ice)"/>
  </svg>`
}

/* One 64×36 color field, updated at most 4 times/second. No blur or full-size
   animated gradient. Disabled outside the viewport, in background tabs, on
   phones, with reduced motion, and by the existing motion/effects switches. */
export function bindBrandMotion(): void {
  const root = document.documentElement
  const surface = document.querySelector<HTMLElement>('.observatory')
  if (!surface) return
  const canvas = document.createElement('canvas')
  canvas.className = 'surface-aurora'
  canvas.width = 64
  canvas.height = 36
  canvas.setAttribute('aria-hidden', 'true')
  surface.prepend(canvas)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const media = matchMedia('(min-width: 681px) and (prefers-reduced-motion: no-preference)')
  let inView = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = false
  let blue = '#8065e5'
  let cyan = '#53c8df'

  const paint = () => {
    if (!active) return
    const t = performance.now() / 18000
    ctx.clearRect(0, 0, 64, 36)
    ctx.globalAlpha = root.dataset.theme === 'dark' ? 0.2 : 0.13
    const glow = (x: number, y: number, r: number, color: string) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, color)
      g.addColorStop(1, 'transparent')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 64, 36)
    }
    glow(18 + Math.sin(t) * 12, 12 + Math.cos(t) * 8, 38, blue)
    glow(46 + Math.cos(t) * 10, 24 + Math.sin(t) * 7, 35, cyan)
    timer = setTimeout(paint, 250)
  }
  const sync = () => {
    const next =
      inView &&
      !document.hidden &&
      media.matches &&
      root.dataset.motion === 'on' &&
      root.dataset.effects !== 'off'
    root.dataset.auroraVisible = String(inView && !document.hidden)
    canvas.dataset.active = String(next)
    const style = getComputedStyle(root)
    blue = style.getPropertyValue('--blue').trim() || blue
    cyan = style.getPropertyValue('--cyan').trim() || cyan
    if (next === active) return
    active = next
    clearTimeout(timer)
    if (active) paint()
    else ctx.clearRect(0, 0, 64, 36)
  }
  document.addEventListener('visibilitychange', sync)
  media.addEventListener('change', sync)
  new MutationObserver(sync).observe(root, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-motion', 'data-effects'],
  })
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting
      sync()
    }).observe(surface)
  }
  sync()
}
