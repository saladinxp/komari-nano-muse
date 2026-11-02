/* Canvas helpers shared by the duty room and the home office: text, the
   square speech box (above a head, or beside it for seated people), sweat drops,
   sleep marks, and drawing a sprite by its feet. */

export const MONO = "'JetBrains Mono', ui-monospace, monospace"
export const SANS = "'Noto Sans SC', 'Sora', system-ui, sans-serif"

export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: CanvasTextAlign = 'left',
  family = SANS,
  weight = 400,
): void {
  ctx.font = `${weight} ${size}px ${family}`
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(s, x, y)
}

/** Shorten `s` with an ellipsis to fit `max` units at `size`. */
export function fit(
  ctx: CanvasRenderingContext2D,
  s: string,
  max: number,
  size: number,
  family = MONO,
): string {
  ctx.font = `${size}px ${family}`
  if (ctx.measureText(s).width <= max) return s
  let t = s
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1)
  return t + '…'
}

/** Square speech box whose tail points at (x, tipY); kept inside [0, W]. */
export function speech(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  tipY: number,
  W: number,
  size = 15,
): void {
  ctx.font = `${size}px ${SANS}`
  const bw = Math.min(320, ctx.measureText(s).width + 26),
    bh = size + 17,
    bx = Math.max(10, Math.min(W - bw - 10, x - bw / 2)),
    by = tipY - bh - 9
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#47698b'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(bx, by)
  ctx.lineTo(bx + bw, by)
  ctx.lineTo(bx + bw, by + bh)
  ctx.lineTo(x + 7, by + bh)
  ctx.lineTo(x, by + bh + 9)
  ctx.lineTo(x - 7, by + bh)
  ctx.lineTo(bx, by + bh)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#1a919d'
  ctx.fillRect(bx, by, 3, bh)
  text(ctx, s, bx + bw / 2 + 1, by + bh / 2, size, '#202c3c', 'center')
}

/** Speech box beside a head instead of above it, tail pointing sideways at it.
    Used for people seated under their own monitor, so the box sits over the desk
    beside the head and the readings above stay visible. (cx, y) is the head
    centre and `reach` half its width; the box opens toward `side` (1 right,
    -1 left) and flips when that would leave [0, W]. */
export function speechBeside(
  ctx: CanvasRenderingContext2D,
  s: string,
  cx: number,
  y: number,
  reach: number,
  W: number,
  side: 1 | -1 = 1,
  size = 15,
): void {
  ctx.font = `${size}px ${SANS}`
  const bw = Math.min(320, ctx.measureText(s).width + 26),
    bh = size + 17,
    gap = 12
  let dir = side
  if (dir > 0 && cx + reach + gap + bw > W - 10) dir = -1
  else if (dir < 0 && cx - reach - gap - bw < 10) dir = 1
  const x = cx + dir * reach,
    bx = dir > 0 ? x + gap : x - gap - bw,
    by = Math.max(10, y - bh / 2),
    ty = by + bh / 2,
    edge = dir > 0 ? bx : bx + bw
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = '#47698b'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(bx, by)
  ctx.lineTo(bx + bw, by)
  if (dir < 0) {
    ctx.lineTo(edge, ty - 7)
    ctx.lineTo(x - 2, ty)
    ctx.lineTo(edge, ty + 7)
  }
  ctx.lineTo(bx + bw, by + bh)
  ctx.lineTo(bx, by + bh)
  if (dir > 0) {
    ctx.lineTo(edge, ty + 7)
    ctx.lineTo(x + 2, ty)
    ctx.lineTo(edge, ty - 7)
  }
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#1a919d'
  ctx.fillRect(bx, by, 3, bh)
  text(ctx, s, bx + bw / 2 + 1, by + bh / 2, size, '#202c3c', 'center')
}

/** Falling sweat drops beside a head at (x, y); `t` in seconds. */
export function sweat(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  drops: number,
  still: boolean,
): void {
  for (let i = 0; i < drops; i++) {
    const p = still ? 0.3 : (t * 0.9 + i * 0.5) % 1,
      dx = x + i * 12,
      dy = y + p * 26
    ctx.globalAlpha = 1 - p * 0.7
    ctx.fillStyle = '#7fd3ff'
    ctx.beginPath()
    ctx.moveTo(dx, dy - 7)
    ctx.quadraticCurveTo(dx + 5, dy + 1, dx, dy + 3)
    ctx.quadraticCurveTo(dx - 5, dy + 1, dx, dy - 7)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** Rising "z Z" next to a sleeper's head. */
export function zzz(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  color: string,
  still: boolean,
): void {
  text(ctx, 'z', x, y + 20 - (still ? 0 : (t * 6) % 6), 14, color)
  text(ctx, 'Z', x + 14, y - (still ? 0 : (t * 6 + 3) % 6), 19, color)
}

/** Draw source rectangle `f` (source-atlas pixels; the image is scaled by `scale`)
    so that source point (ax, ay) lands on (x, y), at `k` scene units per source pixel. */
export function sprite(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  scale: number,
  f: readonly [number, number, number, number],
  ax: number,
  ay: number,
  x: number,
  y: number,
  k: number,
): void {
  ctx.drawImage(
    img,
    f[0] * scale,
    f[1] * scale,
    f[2] * scale,
    f[3] * scale,
    x + (f[0] - ax) * k,
    y + (f[1] - ay) * k,
    f[2] * k,
    f[3] * k,
  )
}
