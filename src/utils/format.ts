/* ── utils ── */
/** Typed getElementById; the views guarantee these ids exist. */
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const esc = s =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
const p2 = n => String(n).padStart(2, '0')
const isCJK = s => /[㐀-鿿豈-﫿]/.test(s || '')
function fB(b, d = 1) {
  if (b == null || isNaN(b)) return '--'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0,
    v = Math.abs(b)
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return (i ? v.toFixed(v >= 100 ? 0 : d) : Math.round(v)) + ' ' + u[i]
}
function fBp(b) {
  const s = fB(b)
  const k = s.lastIndexOf(' ')
  return s.slice(0, k) + '<small>' + s.slice(k + 1) + '</small>'
}
function fS(b) {
  if (b == null || isNaN(b)) return '--'
  const a = Math.abs(b)
  if (a >= 1073741824) return (a / 1073741824).toFixed(2) + ' GB/s'
  if (a >= 1048576) return (a / 1048576).toFixed(1) + ' MB/s'
  if (a >= 1024) return (a / 1024).toFixed(1) + ' KB/s'
  return Math.round(a) + ' B/s'
}
function fUp(s) {
  if (!s) return '--'
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60)
  return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm'
}
function fClock(d) {
  return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())
}
function fDate(d) {
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
}
function fK(b) {
  const u = ['', 'K', 'M', 'G', 'T']
  let i = 0,
    v = Math.abs(b)
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return (v >= 10 || !i ? Math.round(v) : v.toFixed(1)) + u[i]
}
function fMs(v) {
  if (v == null || isNaN(v)) return '--'
  return v >= 100 ? Math.round(v) + ' ms' : v.toFixed(1) + ' ms'
}
function pct(u, t) {
  return t > 0 ? Math.min(100, (u / t) * 100) : 0
}
function css(v) {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue('--' + v)
      .trim() || v
  )
}
function regionCode(r) {
  if (!r) return '--'
  const cps = [...r].map(c => c.codePointAt(0)).filter(c => c >= 0x1f1e6 && c <= 0x1f1ff)
  if (cps.length >= 2) return String.fromCharCode(cps[0] - 0x1f1e6 + 65, cps[1] - 0x1f1e6 + 65)
  return r.length <= 4 ? r.toUpperCase() : r.slice(0, 4)
}
function osShort(os) {
  if (!os) return ''
  return os
    .replace(/\s*GNU\/Linux/i, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function validDate(s: string | undefined): Date | null {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(+d) || d.getFullYear() < 2000 || d.getFullYear() > 2200) return null
  return d
}
function daysLeft(s: string | undefined): number | null {
  const d = validDate(s)
  return d ? Math.ceil((+d - Date.now()) / 86400000) : null
}
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('nm-' + k)
      return v == null ? d : v
    } catch (e) {
      return d
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('nm-' + k, v)
    } catch (e) {}
  },
}

export {
  $,
  css,
  daysLeft,
  esc,
  fB,
  fBp,
  fClock,
  fDate,
  fK,
  fMs,
  fS,
  fUp,
  isCJK,
  osShort,
  p2,
  pct,
  regionCode,
  store,
  validDate,
}
