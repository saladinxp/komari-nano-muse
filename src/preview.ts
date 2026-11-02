/* Offline preview entry: mock Komari API, inlined artwork, then the real app. */
import '../qa/fixtures.js'
import './preview-setup'
import './main'
import { loadNodes, resetMetricStore } from './api/client'
import { setLive } from './api/live'
import { loadFleet } from './hero/halo'
import { applySettings } from './hero/settings'
import { resetEcho } from './nodes/echo'
import { dutyWhere, dutySeatsForQA } from './pages/duty'
import { seed } from './cast/behavior'
import { route } from './router'

/* Hooks for the scenario switcher in qa/fixtures.js. */
window.__NM_APP__ = {
  loadNodes,
  resetMetricStore,
  setLive,
  loadFleet,
  applySettings,
  resetEcho,
  route,
  dutyWhere,
  dutySeatsForQA,
  seedTrack: seed,
}
