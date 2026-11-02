// Screenshot the offline preview (mock data) for visual checks.
// Usage: node qa/screenshot.mjs [route ...]   e.g.  node qa/screenshot.mjs / /detail/demo-0 /stability
// Env: OUT=dir (default qa/shots)  W/H viewport  DARK=1  FULL=1 (full page)
// Requires Playwright with Chromium (preinstalled in the cloud sandbox). Run `npm run build` first.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// require() so a globally installed Playwright is found too (ESM imports ignore NODE_PATH).
const { chromium } = createRequire(import.meta.url)('playwright')

const routes = process.argv.slice(2).length ? process.argv.slice(2) : ['/']
const out = process.env.OUT || 'qa/shots'
mkdirSync(out, { recursive: true })
const file = 'file://' + resolve('preview/NanoMuse-preview.html')

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: +(process.env.W || 1600), height: +(process.env.H || 1000) },
  colorScheme: process.env.DARK ? 'dark' : 'light',
})
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => m.type() === 'error' && errors.push(m.text()))
for (const route of routes) {
  await page.goto(file + '#' + route)
  await page.waitForTimeout(3000)
  const name = (route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home') + '.png'
  await page.screenshot({ path: out + '/' + name, fullPage: !!process.env.FULL })
  console.log('saved', out + '/' + name)
}
console.log('errors:', errors.length ? errors : 'none')
await browser.close()
