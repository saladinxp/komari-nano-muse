import { ASSETS, S, VERSION, visible } from '../state'
import { setMode, setMotion } from '../ui/preferences'
import { $, esc, isCJK, store } from '../utils/format'
import { brandAvatar, brandEmblem, needsSystemTitle } from '../ui/brand'

/* ── hero ── */

/* 1.3.x and 2.x share the theme id `NanoMuse`, so whatever Komari stored on a settings save
   survives upgrades: the version default of that day (e.g. "v1.3.1") and 1.3.1's footer text.
   A version-looking tag is such a leftover, so the footer shows the real version instead;
   any other text (e.g. "PROD") is the owner's own label and is kept. */
const OLD_FOOTER = 'SYSTEM MONITORING ACTIVE'
function versionTag(tag: unknown): string {
  const t = typeof tag === 'string' ? tag.trim() : ''
  return !t || /^v?\d+\.\d+/i.test(t) ? VERSION : t
}

function applySettings() {
  const ts = S.ts
  const title = (ts.hero_title || '').trim() || S.site
  $('brandName').textContent = S.site
  $('brandName').classList.toggle('system-title', needsSystemTitle(S.site))
  $('brandIcon').innerHTML = ts.brand_icon === 'avatar' ? brandAvatar() : brandEmblem('header')
  $('brandIcon').hidden = ts.brand_icon === 'none'
  $('brandSub').textContent = ((ts.brand_sub || '').trim() || 'NANOMUSE · OBSERVATORY').toUpperCase()
  const h = $('heroTitle'),
    cjk = isCJK(title)
  h.classList.toggle('cjk', cjk)
  h.classList.toggle('system-title', needsSystemTitle(title))
  h.innerHTML = title === 'NanoMuse' ? 'Nano<em>Muse</em>' : esc(title)
  h.style.fontSize = title.length > 16 ? 'clamp(28px,2.8vw,62px)' : ''
  $('heroSub').textContent = (ts.hero_subtitle || '').trim() || '静默观测，信号常在。'
  $('heroQuote').textContent =
    (ts.hero_quote || '').trim() || '在寂静里守望每一束信号，于万千链路中听见回响。'
  $('notice').hidden = !ts.announce_text
  $('notice').textContent = ts.announce_text || ''
  $('fVer').textContent = versionTag(ts.version_tag)
  const foot = (ts.footer_text || '').trim()
  $('fText').textContent = foot && foot !== OLD_FOOTER ? foot : S.site + ' · 系统观测中'
  if (ts.default_mode && !store.get('mode', null)) setMode(ts.default_mode, false)
  $('portrait').style.display = ts.show_char === 'off' ? 'none' : ''
  $('orbit').classList.toggle('no-char', ts.show_char === 'off')
  document.documentElement.dataset.effects = ts.visual_effects === 'off' ? 'off' : 'on'
  setMotion(store.get('motion', ts.background_motion || 'on'), false)
  uChar(true)
}
/* character: awake art when every visible node is online */
function uChar(force = false) {
  const vis = visible(),
    all = vis.length > 0 && vis.every(n => S.online.has(n.uuid))
  const st = all ? 'awake' : 'sleep'
  $('phase').innerHTML = all
    ? 'SIGNAL · <b>RESONANCE</b> <span class="zh">共鸣</span>'
    : 'SIGNAL · <b>LISTENING</b> <span class="zh">聆听中</span>'
  if (!force && S._charSt === st) return
  S._charSt = st
  const ts = S.ts,
    box = $('portrait')
  const vid = all ? ts.bg_video_awake || ts.bg_video : ts.bg_video
  const img = all ? ts.char_awake_url || ts.char_url || ASSETS.awake : ts.char_url || ASSETS.sleep
  let el = box.firstElementChild as HTMLImageElement | HTMLVideoElement | null
  if (vid) {
    if (!el || el.tagName !== 'VIDEO') {
      box.innerHTML = '<video autoplay muted loop playsinline></video>'
      el = box.firstElementChild as HTMLVideoElement
    }
    if (el.getAttribute('src') !== vid) {
      el.src = vid
      el.style.opacity = String(parseFloat(ts.bg_video_opacity) || 1)
    }
    box.classList.add('in')
  } else {
    if (!el || el.tagName !== 'IMG') {
      box.innerHTML = '<img alt="NanoMuse 戴耳机静静聆听信号" decoding="async">'
      el = box.firstElementChild as HTMLImageElement
    }
    if (el.getAttribute('src') !== img) {
      const pre = new Image()
      pre.onload = () => {
        el.src = img
        box.classList.add('in')
      }
      pre.onerror = () => {
        const fb = ts.char_url || ASSETS.fallback
        if (img !== fb) {
          el.src = fb
          box.classList.add('in')
        }
      }
      pre.src = img
    }
  }
}

export { versionTag, applySettings, uChar }
