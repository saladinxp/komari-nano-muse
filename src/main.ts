import './styles/main.css'
import { mountViews } from './views/mount'
import { bindStability } from './pages/stability'
import { bindTraffic, loadTrafficHistory } from './pages/traffic'
import { bindBilling } from './pages/billing'
import { bindMap } from './pages/worldmap'
import { bindNodeList } from './nodes/list'
import { loadNodeTelemetry } from './nodes/telemetry'
import { loadMe, loadNodes, loadPublic } from './api/client'
import { connect } from './api/live'
import { loadFleet, orbitInit } from './hero/halo'
import { applySettings } from './hero/settings'
import { rSummary } from './hero/summary'
import { bindEcho, loadEcho } from './nodes/echo'
import { bindDetail, rDetCharts } from './pages/detail'
import { bindDuty } from './pages/duty'
import { bindHome } from './pages/home'
import { bindSignalLog } from './hero/signal'
import { bindRouter, route } from './router'
import { S } from './state'
import { phArt } from './ui/ambient'
import { bindPreferences, setMode } from './ui/preferences'

/* ── boot ── */
;(async function init() {
  mountViews()
  bindPreferences()
  bindRouter()
  bindEcho()
  bindNodeList()
  bindDetail()
  bindDuty()
  bindHome()
  bindSignalLog()
  bindBilling()
  bindMap()
  bindStability()
  bindTraffic()
  setMode(document.documentElement.dataset.mode || 'auto', false)
  orbitInit()
  phArt()
  route()
  await Promise.all([loadPublic(), loadNodes(), loadMe()])
  S._loaded = true
  applySettings()
  route()
  rSummary()
  connect()
  loadFleet()
  setInterval(loadFleet, 300000)
  setInterval(() => {
    if (S.page === 'dashboard' && document.visibilityState === 'visible') {
      void loadEcho()
      void loadNodeTelemetry()
    }
    if (S.page === 'worldmap' && document.visibilityState === 'visible') void loadEcho()
    if (S.page === 'traffic' && document.visibilityState === 'visible') void loadTrafficHistory()
  }, 60000)
  setInterval(() => {
    if (S.page === 'detail' && document.visibilityState === 'visible' && S.det.hours <= 6) rDetCharts()
  }, 60000)
})()
