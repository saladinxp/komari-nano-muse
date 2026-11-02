/* Page markup lives in src/views; it is mounted once, before any module binds events. */
import chrome from './chrome.html?raw'
import header from './header.html?raw'
import dashboard from './dashboard.html?raw'
import duty from './duty.html?raw'
import detail from './detail.html?raw'
import stability from './stability.html?raw'
import worldmap from './worldmap.html?raw'
import billing from './billing.html?raw'
import traffic from './traffic.html?raw'
import footer from './footer.html?raw'
import { brandEmblem } from '../ui/brand'

export function mountViews(): void {
  const brandedHeader = header.replace('<!-- BRAND_MARK -->', brandEmblem('header'))
  const brandedDashboard = dashboard.replace('<!-- HERO_MARK -->', brandEmblem('hero'))
  const pages = [brandedDashboard, duty, detail, stability, worldmap, billing, traffic].join('\n')
  document.body.insertAdjacentHTML(
    'afterbegin',
    chrome + brandedHeader + '<main>\n' + pages + '</main>\n' + footer,
  )
}
