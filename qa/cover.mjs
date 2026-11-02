// Theme cover: screenshot the offline preview home page into preview.jpg (the card in Komari's theme
// manager and the README image). Run `npm run build` first; re-run whenever the home page look changes.
// Usage: node qa/cover.mjs [out=preview.jpg]
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const { chromium } = createRequire(import.meta.url)('playwright')
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: 'light' })
await p.goto('file://' + resolve('preview/NanoMuse-preview.html') + '#/')
await p.waitForTimeout(5000)
await p.evaluate(async () => {
  document.querySelector('.demo-banner')?.remove()
  await document.fonts.ready
  window.scrollTo(0, 0)
})
await p.waitForTimeout(1500)
await p.screenshot({ path: process.argv[2] || 'preview.jpg', type: 'jpeg', quality: 86 })
await b.close()
