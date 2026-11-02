import { $ } from '../utils/format'

/* ── ambient specks ── */
function motes() {
  let h = ''
  for (let i = 0; i < 14; i++) {
    const r = Math.random,
      s = (1.5 + r() * 2).toFixed(1)
    h += `<i style="left:${(r() * 100).toFixed(1)}%;top:${(20 + r() * 80).toFixed(1)}%;width:${s}px;height:${s}px;animation-delay:-${(r() * 16).toFixed(1)}s;animation-duration:${(12 + r() * 10).toFixed(0)}s"></i>`
  }
  $('motes').innerHTML = h
}
/* small ring motif for inner page heads */
function phArt() {
  let t = ''
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2,
      l = i % 4 ? 4 : 9,
      [x1, y1] = [100 + 78 * Math.cos(a), 100 + 78 * Math.sin(a)],
      [x2, y2] = [100 + (78 + l) * Math.cos(a), 100 + (78 + l) * Math.sin(a)]
    t += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--ink4)" stroke-width="1" opacity="${i % 4 ? 0.5 : 0.9}"/>`
  }
  const g = `<circle cx="100" cy="100" r="64" fill="none" stroke="var(--line)"/><circle cx="100" cy="100" r="50" fill="none" stroke="url(#gBlue)" stroke-width="1.5" stroke-dasharray="210 120" stroke-linecap="round" transform="rotate(-120 100 100)"/><circle cx="100" cy="100" r="30" fill="var(--blue-s)"/><circle cx="100" cy="100" r="5" fill="url(#gBlue)"/>${t}<g class="o-spin" style="transform-origin:100px 100px"><circle cx="100" cy="6" r="3" class="o-sat"/></g>`
  document.querySelectorAll<HTMLElement>('.ph-art').forEach(s => (s.innerHTML = g))
}

export { phArt }
