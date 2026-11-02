import { rSignalLog } from './hero/signal'
import { rNodes } from './nodes/list'
import { syncEchoTrends } from './nodes/echo'
import { rBilling } from './pages/billing'
import { openDetail } from './pages/detail'
import { openDuty } from './pages/duty'
import { openStab } from './pages/stability'
import { rMap } from './pages/worldmap'
import { openTraffic } from './pages/traffic'
import type { Page } from './types/state'
import { HASH_ROUTER, S } from './state'
import { $ } from './utils/format'
import { hideTip } from './ui/tip'

/* ── router ── */
const currentPath = () => (HASH_ROUTER() ? location.hash.slice(1) || '/' : location.pathname)
const PAGES: Page[] = ['dashboard', 'duty', 'detail', 'stability', 'worldmap', 'billing', 'traffic']
function route() {
  const p = currentPath()
  let page: Page = 'dashboard'
  if (p.startsWith('/detail/')) {
    page = 'detail'
    S.det.uuid = decodeURIComponent(p.slice(8).split('/')[0])
  } else if (p === '/duty') page = 'duty'
  else if (p === '/stability') page = 'stability'
  else if (p === '/worldmap' || p === '/map') page = 'worldmap'
  else if (p === '/billing') page = 'billing'
  else if (p === '/traffic') page = 'traffic'
  S.page = page
  hideTip()
  if (page !== 'dashboard') syncEchoTrends()
  PAGES.forEach(x => $('pg-' + x).classList.toggle('on', x === page))
  document
    .querySelectorAll<HTMLElement>('#nav a')
    .forEach(a =>
      a.classList.toggle('on', a.dataset.p === page || (page === 'detail' && a.dataset.p === 'dashboard')),
    )
  if (page === 'dashboard') {
    rNodes()
    rSignalLog()
  } else if (page === 'duty') openDuty()
  else if (page === 'detail') openDetail()
  else if (page === 'stability') openStab()
  else if (page === 'worldmap') rMap()
  else if (page === 'billing') rBilling()
  else if (page === 'traffic') openTraffic()
  document.title = (page === 'detail' && nodeBy(S.det.uuid) ? nodeBy(S.det.uuid).name + ' · ' : '') + S.site
}
function nav(href) {
  if (href === currentPath()) return
  if (HASH_ROUTER()) location.hash = href
  else history.pushState(null, '', href)
  route()
  window.scrollTo({ top: 0, behavior: 'instant' })
}
const nodeBy = u => S.nodes.find(n => n.uuid === u)

/* Event wiring, called once from main after the views are mounted. */
function bindRouter() {
  document.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('a[data-nav]')
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    if (a.getAttribute('href').startsWith('/detail/'))
      S.det.tab = a.dataset.metric === 'ping' ? 'ping' : 'load'
    nav(a.getAttribute('href'))
  })
  window.addEventListener(HASH_ROUTER() ? 'hashchange' : 'popstate', route)
}

export { bindRouter, nav, nodeBy, route }
