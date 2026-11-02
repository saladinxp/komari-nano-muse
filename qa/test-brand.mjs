// Resource-budget and visibility behavior of the optional color field.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const { brandEmblem, bindBrandMotion, needsSystemTitle } = await server.ssrLoadModule('/src/ui/brand.ts')
  assert.equal(needsSystemTitle('纳米核心'), false)
  assert.equal(needsSystemTitle('纳米缪斯'), false)
  assert.equal(needsSystemTitle('NanoMuse'), false)
  assert.equal(needsSystemTitle('纳米观测站'), true)
  assert.equal(needsSystemTitle('纳米の核心'), true)
  const ids = [...(brandEmblem('header') + brandEmblem('hero')).matchAll(/id="([^"]+)"/g)].map(m => m[1])
  assert.equal(new Set(ids).size, ids.length)
  let intersection, mutation, visibility, mediaChange, timer
  let paints = 0
  const root = { dataset: { motion: 'on', effects: 'on', theme: 'light' } }
  const ctx = {
    clearRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {
      paints++
    },
  }
  const canvas = { dataset: {}, setAttribute() {}, getContext: () => ctx }
  const media = { matches: true, addEventListener: (_, fn) => (mediaChange = fn) }
  const original = new Map()
  const mock = (key, value) => {
    original.set(key, globalThis[key])
    globalThis[key] = value
  }
  const doc = {
    hidden: false,
    documentElement: root,
    querySelector: () => ({ prepend() {} }),
    createElement: () => canvas,
    addEventListener: (_, fn) => (visibility = fn),
  }
  mock('document', doc)
  mock('window', { IntersectionObserver: true })
  mock('matchMedia', () => media)
  mock('getComputedStyle', () => ({ getPropertyValue: () => '#7b60d9' }))
  mock(
    'IntersectionObserver',
    class {
      constructor(fn) {
        intersection = fn
      }
      observe() {}
    },
  )
  mock(
    'MutationObserver',
    class {
      constructor(fn) {
        mutation = fn
      }
      observe() {}
    },
  )
  mock('setTimeout', (fn, ms) => {
    assert.equal(ms, 250)
    timer = fn
    return 1
  })
  mock('clearTimeout', () => (timer = undefined))
  try {
    bindBrandMotion()
    assert.deepEqual([canvas.width, canvas.height], [64, 36])
    assert.equal(timer, undefined, 'no work before the surface is visible')
    intersection([{ isIntersecting: true }])
    assert.equal(canvas.dataset.active, 'true')
    assert.equal(paints, 2)
    assert.equal(typeof timer, 'function', 'one next frame scheduled at 250 ms')
    doc.hidden = true
    visibility()
    assert.equal(timer, undefined, 'hidden tab cancels the timer')
    doc.hidden = false
    visibility()
    root.dataset.motion = 'off'
    mutation()
    assert.equal(timer, undefined, 'motion switch cancels the timer')
    root.dataset.motion = 'on'
    mutation()
    root.dataset.effects = 'off'
    mutation()
    assert.equal(timer, undefined, 'effects switch cancels the timer')
    root.dataset.effects = 'on'
    mutation()
    media.matches = false
    mediaChange()
    assert.equal(timer, undefined, 'phone / reduced-motion stays static')
    media.matches = true
    mediaChange()
    intersection([{ isIntersecting: false }])
    assert.equal(timer, undefined, 'offscreen surface cancels the timer')
    console.log(
      'Brand: unique SVG IDs, 64×36 / max 4 fps, tab / motion / effects / media / viewport gates passed.',
    )
  } finally {
    for (const [key, value] of original) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
  }
} finally {
  await server.close()
}
