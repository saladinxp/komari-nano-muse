// CPU cost of the home page's animations in the offline preview. Each case loads the page, applies
// a CSS override (to switch one animation off, or change how it runs), then measures the CPU time
// of every browser process (renderer, GPU / compositor, browser) for 8 s through CDP.
//
// Headless Chromium has no GPU here, so compositing is done in software and the absolute numbers
// run high. Compare cases with each other, on the same machine, not with a real desktop.
//
// Usage: node qa/bench-motion.mjs [preview.html=preview/NanoMuse-preview.html] [seconds=8]
// Run `npm run build` first. Prints one line per case: share of one CPU core.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const { chromium } = createRequire(import.meta.url)('playwright')
const file = 'file://' + resolve(process.argv[2] || 'preview/NanoMuse-preview.html') + '#/'
const seconds = +(process.argv[3] || 8)

const SIDES = '.ambient .ambient-left,.ambient .ambient-right{animation:none!important}'
const HALO_STOP = '.halo .h-spin{animation:none!important}'
/* 140 s and 90 s per turn → steps(560) / steps(360) = 4 steps per second */
const HALO_STEP4 =
  '.halo .h-spin{animation-timing-function:steps(560)!important}.halo .h-spin.rev{animation-timing-function:steps(360)!important}'
const CASES = [
  ['as built, motion on', ''],
  ['motion button off', 'click:#motionBtn'],
  ['side wireframes stopped', SIDES],
  ['halo spin stopped', HALO_STOP],
  ['sides stopped + halo 4 steps/s', SIDES + HALO_STEP4],
  ['sides + halo stopped', SIDES + HALO_STOP],
  ['everything stopped (incl. aurora canvas)', SIDES + HALO_STOP + '.surface-aurora{display:none!important}'],
]

const browser = await chromium.launch()
const cpu = async s =>
  (await s.send('SystemInfo.getProcessInfo')).processInfo.reduce((a, p) => a + p.cpuTime, 0)
try {
  for (const [name, how] of CASES) {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
    const page = await ctx.newPage()
    const session = await browser.newBrowserCDPSession()
    await page.goto(file)
    await page.waitForTimeout(3500)
    if (how.startsWith('click:')) await page.click(how.slice(6))
    else if (how) await page.addStyleTag({ content: how })
    await page.waitForTimeout(1500)
    const running = await page.evaluate(
      () => document.getAnimations().filter(a => a.playState === 'running').length,
    )
    const c0 = await cpu(session)
    await page.waitForTimeout(seconds * 1000)
    const c1 = await cpu(session)
    console.log(
      name.padEnd(42),
      (((c1 - c0) / seconds) * 100).toFixed(1).padStart(5) + '% of a core',
      `| ${running} CSS animations running`,
    )
    await ctx.close()
  }
} finally {
  await browser.close()
}
