// Playwright preload for local acceptance: answer Google Fonts requests with empty
// responses so the disposable instance never needs the internet (fonts fall back locally).
const { createRequire } = require('module')
const req = createRequire(process.cwd() + '/package.json')
const pw = req('playwright')
const blockFonts = async ctx => {
  await ctx.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route =>
    route.fulfill({
      status: 200,
      contentType: route.request().url().includes('googleapis') ? 'text/css' : 'font/woff2',
      body: '',
    }),
  )
  return ctx
}
const launch = pw.chromium.launch.bind(pw.chromium)
pw.chromium.launch = async (...args) => {
  const browser = await launch(...args)
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (...a) => blockFonts(await newContext(...a))
  browser.newPage = async (...a) => {
    const ctx = await browser.newContext(...a)
    const page = await ctx.newPage()
    page.close = (
      orig =>
      async (...c) => {
        await orig(...c)
        await ctx.close()
      }
    )(page.close.bind(page))
    return page
  }
  return browser
}
