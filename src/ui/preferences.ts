import { redrawAll } from '../charts/chart'
import { S } from '../state'
import { $, store } from '../utils/format'
import { bindBrandMotion } from './brand'

/* ══ colour mode ══ */
const mq = matchMedia('(prefers-color-scheme: dark)')
const MODE_ICON = {
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>',
  light:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
}
function setMode(m, save = true) {
  if (!['auto', 'light', 'dark'].includes(m)) m = 'auto'
  document.documentElement.dataset.mode = m
  document.documentElement.dataset.theme = m === 'dark' || (m === 'auto' && mq.matches) ? 'dark' : 'light'
  $('modeBtn').innerHTML =
    MODE_ICON[m] + '<span>' + { auto: '自动', light: '浅色', dark: '深色' }[m] + '</span>'
  $('modeBtn').title = '配色：' + { auto: '跟随系统', light: '浅色', dark: '深色' }[m]
  if (save) store.set('mode', m)
  requestAnimationFrame(redrawAll)
}

/* Motion preference applies to the real theme as well as the preview. */
const motionQuery = matchMedia('(prefers-reduced-motion:reduce)')
function setMotion(value, save = true) {
  const enabled = value !== 'off' && !motionQuery.matches
  document.documentElement.dataset.motion = enabled ? 'on' : 'off'
  const b = $('motionBtn')
  b.setAttribute('aria-pressed', String(enabled))
  b.querySelector<HTMLElement>('span').textContent = enabled ? '动效' : '静止'
  b.title = motionQuery.matches ? '已按系统减少动态偏好暂停' : enabled ? '暂停背景动效' : '开启背景动效'
  if (save) store.set('motion', value)
}

/* Event wiring, called once from main after the views are mounted. */
function bindPreferences() {
  bindBrandMotion()
  $('modeBtn').addEventListener('click', () => {
    const o = ['auto', 'light', 'dark']
    setMode(o[(o.indexOf(document.documentElement.dataset.mode) + 1) % 3])
  })
  mq.addEventListener('change', () => {
    if (document.documentElement.dataset.mode === 'auto') setMode('auto', false)
  })
  $('motionBtn').addEventListener('click', () =>
    setMotion(document.documentElement.dataset.motion === 'on' ? 'off' : 'on'),
  )
  motionQuery.addEventListener('change', () =>
    setMotion(store.get('motion', S.ts.background_motion || 'on'), false),
  )
}

export { bindPreferences, setMode, setMotion }
