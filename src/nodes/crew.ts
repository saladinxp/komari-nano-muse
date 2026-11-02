/* A small, static duty presence in Stellar Core. Uses the same UUID binding and
   real-state track and shared history seed as the room. No animation loop or new art. */
import { art, onArt } from '../cast/art'
import { moodOf, trackOf } from '../cast/behavior'
import { ATLASES, castNodes, characterOf, type Pose } from '../cast/roster'
import { S, visible } from '../state'
import { esc, store } from '../utils/format'
import { seedHistory } from '../cast/history'

let historyRequested = false
let historyPending = false

export const coreCrewEnabled = (): boolean => store.get('core-crew', S.ts.core_crew || 'off') !== 'off'

export function crewState(uuid: string): { pose: Pose; label: string; tone: string } {
  if (!S.lastSync || trackOf(uuid).online == null) return { pose: 'idle', label: '等待同步', tone: 'waiting' }
  if (!S.online.has(uuid)) return { pose: 'sleep', label: '离线休眠', tone: 'offline' }
  if (historyPending && trackOf(uuid).cpu < 5) return { pose: 'idle', label: '同步历史', tone: 'waiting' }
  const mood = moodOf(uuid)
  if (mood === 'idle') return { pose: 'coffee', label: '休息待命', tone: 'idle' }
  if (mood === 'alert' || mood === 'call') return { pose: 'idle', label: '高负载值守', tone: 'alert' }
  if (mood === 'busy') return { pose: 'idle', label: '忙碌中', tone: 'busy' }
  return { pose: 'idle', label: '在岗', tone: 'work' }
}

export const coreCrew = (uuid: string): string =>
  `<figure class="core-crew" data-core-crew="${esc(uuid)}" aria-label="节点值班员"></figure>`

export function updateCoreCrew(): void {
  if (S.page !== 'dashboard' || S.view !== 'large' || !coreCrewEnabled()) return
  castNodes(visible())
  if (S.lastSync && !historyRequested) {
    historyRequested = true
    historyPending = true
    void seedHistory().finally(() => {
      historyPending = false
      updateCoreCrew()
    })
  }
  document.querySelectorAll<HTMLElement>('[data-core-crew]').forEach((el, index) => {
    const uuid = el.dataset.coreCrew!,
      c = characterOf(uuid),
      state = crewState(uuid),
      atlas = ATLASES[c.atlas],
      slot = art(atlas.art),
      key = [c.key, state.pose, state.tone, slot.ready, slot.failed].join(':')
    if (el.dataset.frame === key) return
    el.dataset.frame = key
    el.dataset.mood = state.tone
    const [x, y, w, h] = c.frames[state.pose].map(v => v * atlas.scale)
    const clip = 'nm-core-crew-' + index
    const sprite = slot.ready
      ? `<svg viewBox="${x} ${y} ${w} ${h}" aria-hidden="true" focusable="false"><defs><clipPath id="${clip}" clipPathUnits="userSpaceOnUse"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs><image clip-path="url(#${clip})" href="${esc(slot.img.src)}" width="${slot.img.naturalWidth}" height="${slot.img.naturalHeight}"/></svg>`
      : '<span class="core-crew-placeholder" aria-hidden="true">◇</span>'
    const sweat =
      state.tone === 'busy' || state.tone === 'alert'
        ? `<svg class="core-crew-sweat" viewBox="0 0 20 22" aria-hidden="true"><path d="M6 2C6 2 2 8 2 11a4 4 0 0 0 8 0C10 8 6 2 6 2Z"/>${state.tone === 'alert' ? '<path d="M15 9s-3 4-3 6a3 3 0 0 0 6 0c0-2-3-6-3-6Z"/>' : ''}</svg>`
        : ''
    el.title = c.name + ' · ' + state.label
    el.setAttribute('aria-label', el.title)
    el.innerHTML = `<span class="core-crew-art">${sprite}${sweat}</span><figcaption><b>${esc(c.name)}</b><span>${state.label}</span></figcaption>`
  })
}

export function bindCoreCrew(refresh: () => void): void {
  onArt(updateCoreCrew)
  document.getElementById('coreCrewToggle')!.addEventListener('click', () => {
    store.set('core-crew', coreCrewEnabled() ? 'off' : 'on')
    refresh()
  })
}

export function updateCoreControls(): void {
  document.getElementById('coreControls')!.hidden = S.view !== 'large'
  const button = document.getElementById('coreCrewToggle')!
  const enabled = coreCrewEnabled()
  button.textContent = '值班员：' + (enabled ? '开' : '关')
  button.setAttribute('aria-pressed', String(enabled))
}
