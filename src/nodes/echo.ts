import {
  getJson,
  hasMetricStore,
  pingTasks,
  pmap,
  probesFor,
  queryMetrics,
  resetPingTasks,
} from '../api/client'
import { filtered, updateNodeSignals } from './list'
import { echoTimeoutHint, renderEchoTrend } from './echo-trend'
import { resetNodeTelemetry } from './telemetry'
import { nodeBy } from '../router'
import { S, visible } from '../state'
import type { MetricPoint, PingTaskDef } from '../types/komari'
import { $, esc, fClock, fMs, fS, osShort, p2, regionCode } from '../utils/format'
import { metrics } from '../utils/metrics'
import { usageBlock, updateUsageBlocks } from '../utils/usage'
import {
  bindEchoPresets,
  echoGroup,
  echoTaskName,
  customTasks,
  hasCustomTasks,
  presetRows,
  setEchoTaskDefs,
  syncEchoPresetControls,
} from './echo-presets'

/* Echo mode reads existing server probes only while this view is in use. */
function packEcho(id, name, latency, loss, now = Date.now(), interval = 60, bucketSeconds = 0) {
  const by = new Map(),
    start = now - 3600000
  const add = (p, kind) => {
    const t = +new Date(p.time)
    if (!Number.isFinite(t) || t < start || t > now + 60000) return
    const v = p.value
    const q = by.get(t) || { t, lat: null, loss: null, timeout: false, hasLatency: false }
    if (kind === 'lat') {
      if (v != null && !Number.isFinite(v)) return
      q.hasLatency = true
      q.lat = v != null && v >= 0 ? v : null
      q.timeout = v != null && v < 0
    } else {
      if (!Number.isFinite(v) || v < 0 || v > 1) return
      q.loss = v
    }
    by.set(t, q)
  }
  ;(latency || []).forEach(p => add(p, 'lat'))
  ;(loss || []).forEach(p => add(p, 'loss'))
  const all = [...by.values()].sort((a, b) => a.t - b.t)
  const trace = all.filter(p => p.hasLatency || p.loss === 1),
    last = trace[trace.length - 1] || all[all.length - 1] || null
  const points =
    trace.length > 96
      ? Array.from({ length: 96 }, (_, i) => trace[Math.round((i * (trace.length - 1)) / 95)])
      : trace
  const lp = all.filter(p => p.loss != null).map(p => p.loss),
    vs = all.filter(p => p.lat != null).map(p => p.lat)
  return {
    id,
    name,
    interval,
    bucketSeconds,
    points,
    samples: all,
    last,
    loss: lp.length ? (lp.reduce((a, b) => a + b, 0) / lp.length) * 100 : null,
    avg: vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null,
  }
}
function echoTrace(task, now = Date.now()) {
  return `<span class="echo-trend" data-echo-trend="${Number(task.id)}">${renderEchoTrend(task, 135, now)}</span>`
}
function echoTarget(t) {
  const p = t.last,
    stale = p && Date.now() - p.t > Math.max(300000, ((t.interval || 60) + (t.bucketSeconds || 0)) * 1000),
    timeout = p && (p.timeout || p.loss === 1),
    bad = timeout || (t.loss != null && t.loss >= 5),
    warn = stale || (t.loss != null && t.loss > 0)
  const hint = echoTimeoutHint(t)
  const val = !p ? '—' : timeout ? '超时' : p.lat == null ? '—' : fMs(p.lat),
    age = !p ? '暂无样本' : stale ? '旧样本 · ' + fClock(new Date(p.t)) : '采样 ' + fClock(new Date(p.t))
  return `<div class="echo-target${bad ? ' bad' : warn ? ' warn' : ''}" title="${esc(age)} · 1H 均值 ${esc(fMs(t.avg))} · 1H 丢包 ${t.loss == null ? '—' : t.loss.toFixed(1) + '%'}${hint ? ' · ' + esc(hint) : ''}"><span class="echo-target-name" title="${esc(t.fullName || t.name)}">${esc(echoTaskName(t.name))}</span><strong>${esc(val)}</strong><span class="echo-loss">${t.loss == null ? '—' : (t.loss === 100 ? '100' : t.loss.toFixed(1)) + '%'}<small>丢包</small></span>${echoTrace(t)}${hint ? '<span class="echo-timeout-note">' + esc(hint) + '</span>' : ''}</div>`
}
function echoBody(n) {
  const entry = S.echo.entries[n.uuid]
  if (echoGroup() === 'preset')
    return (
      (entry?.error ? '<div class="echo-retry-note">本次更新失败 · 保留上次样本</div>' : '') +
      presetRows(entry?.tasks || [], n.uuid)
        .map(row =>
          row.task
            ? echoTarget(row.task)
            : `<div class="echo-target echo-preset-empty" title="${esc(row.name)} · ${esc(row.message)}"><span class="echo-target-name" title="${esc(row.name)}">${esc(row.name)}</span><strong>—</strong><span class="echo-loss">—<small>丢包</small></span><span class="echo-trend" data-echo-trend="0">${renderEchoTrend({ points: [] }, 135)}</span><span class="echo-wait">${esc(row.message)}</span></div>`,
        )
        .join('')
    )
  if (!entry)
    return '<div class="echo-empty">' + (S.echo.pending ? '正在接收回声…' : '等待拨测数据') + '</div>'
  if (entry.error && !entry.tasks.length)
    return '<div class="echo-empty">拨测暂时无法读取<span>可稍后刷新重试</span></div>'
  if (!entry.tasks.length)
    return (
      '<div class="echo-empty">' +
      (entry.configured ? '最近1小时暂无拨测样本' : '此节点尚未配置拨测') +
      '<span>配置后将在这里显示各目标链路</span></div>'
    )
  return (
    (entry.error ? '<div class="echo-retry-note">本次更新失败 · 保留上次样本</div>' : '') +
    (customTasks(entry.tasks).map(echoTarget).join('') ||
      (hasCustomTasks(entry.tasks)
        ? '<div class="echo-empty">未选择可用目标<span>可在“选择目标”中调整</span></div>'
        : '<div class="echo-empty">还没有自定义目标<span>默认四线在「默认四线」里看；后台自建的拨测任务会显示在这里</span></div>'))
  )
}
function echoCard(n, i) {
  const ready = !!S.lastSync,
    on = S.online.has(n.uuid),
    m = metrics(n)
  return `<a class="nc echo-card${ready && !on ? ' off' : ''}" href="/detail/${encodeURIComponent(n.uuid)}" data-nav data-metric="ping" data-u="${esc(n.uuid)}"><div class="echo-identity"><div class="echo-code"><span>◈ ECHO / ${p2(i + 1)}</span><span>↗</span></div><div class="nc-h"><span class="flag">${esc(regionCode(n.region))}</span><span class="nc-n" title="${esc(n.name)}">${esc(n.name)}</span></div><div class="echo-region">${esc(n.group || osShort(n.os) || 'NODE LINK')}</div><span class="echo-node-state" data-echo-live="state">${!ready ? '等待节点快照' : on ? '● 在线 · 链路采样' : '● 节点离线 · 历史样本'}</span><div class="echo-live-net"><span>↑ <b data-echo-live="up">${ready && on && m.hasNetwork ? fS(m.up) : '—'}</b></span><span>↓ <b data-echo-live="down">${ready && on && m.hasNetwork ? fS(m.down) : '—'}</b></span></div>${usageBlock(n)}<span class="echo-window">节点 → 目标 / 1H<br>点击查看完整拨测历史</span></div><div class="echo-targets" data-echo-body>${echoBody(n)}</div></a>`
}
function updateEchoLive() {
  updateUsageBlocks()
  document.querySelectorAll<HTMLElement>('#nodes .echo-card').forEach(el => {
    const n = nodeBy(el.dataset.u)
    if (!n) return
    const on = S.online.has(n.uuid),
      m = metrics(n)
    el.classList.toggle('off', !!S.lastSync && !on)
    el.querySelector<HTMLElement>('[data-echo-live="state"]').textContent = !S.lastSync
      ? '等待节点快照'
      : on
        ? '● 在线 · 链路采样'
        : '● 节点离线 · 历史样本'
    el.querySelector<HTMLElement>('[data-echo-live="up"]').textContent =
      S.lastSync && on && m.hasNetwork ? fS(m.up) : '—'
    el.querySelector<HTMLElement>('[data-echo-live="down"]').textContent =
      S.lastSync && on && m.hasNetwork ? fS(m.down) : '—'
  })
}
let trendObserver: ResizeObserver | null = null
const trendWidths = new WeakMap<Element, number>()
function paintEchoTrend(el: HTMLElement, width: number) {
  if (width <= 0 || document.hidden || S.page !== 'dashboard' || S.view !== 'list') return
  if (trendWidths.get(el) === width) return
  trendWidths.set(el, width)
  const uuid = el.closest<HTMLElement>('[data-u]')?.dataset.u
  const entry = S.echo.entries[uuid]
  const task = entry?.tasks.find(t => Number(t.id) === Number(el.dataset.echoTrend)) || { points: [] }
  el.innerHTML = renderEchoTrend(task, width, entry?.at || Date.now())
}
export function syncEchoTrends() {
  trendObserver?.disconnect()
  if (S.page !== 'dashboard' || S.view !== 'list') return
  trendObserver ||= new ResizeObserver(entries => {
    for (const e of entries) paintEchoTrend(e.target as HTMLElement, e.contentRect.width)
  })
  // Batch geometry reads before any writes. Resizing redraws only the static SVG;
  // it never requests metrics or adds per-card timers.
  const slots = [...document.querySelectorAll<HTMLElement>('#nodes [data-echo-trend]')].map(el => ({
    el,
    width: el.getBoundingClientRect().width,
  }))
  for (const { el, width } of slots) {
    paintEchoTrend(el, width)
    trendObserver.observe(el)
  }
}
function updateEchoCaption() {
  syncEchoPresetControls()
  syncEchoTrends()
  const entries = filtered().map(n => S.echo.entries[n.uuid]),
    at = entries.map(e => (e && e.at) || 0).filter(Boolean),
    errors = entries.some(e => e && e.error)
  $('echoSync').textContent = S.echo.pending
    ? '正在读取拨测…'
    : errors
      ? '部分拨测读取失败'
      : at.length
        ? '更新 ' + fClock(new Date(Math.max(...at))) + ' · 60秒刷新'
        : '按需读取拨测'
  $<HTMLButtonElement>('echoRefresh').disabled = !!S.echo.pending
}
/* The Star Map reads the same entries; it redraws when a batch starts or lands. */
let echoListener: () => void = () => {}
function onEchoData(fn: () => void) {
  echoListener = fn
}
function renderEchoBodies() {
  if (S.page === 'worldmap') echoListener()
  if (S.page !== 'dashboard') return
  if (S.view !== 'list') {
    updateNodeSignals()
    return
  }
  bodyGroup = echoGroup()
  document.querySelectorAll<HTMLElement>('#nodes .echo-card').forEach(el => {
    const n = nodeBy(el.dataset.u)
    if (n) el.querySelector<HTMLElement>('[data-echo-body]').innerHTML = echoBody(n)
  })
  updateEchoCaption()
}
/* Cards stay in the DOM while another page is open; redraw their bodies once if the
   默认四线 / 自定义目标 choice changed meanwhile (e.g. in another tab via localStorage). The
   detail page no longer changes it: it shows both groups in separate boxes. */
let bodyGroup: string | null = null
function syncEchoGroup() {
  if (S.page === 'dashboard' && S.view === 'list' && bodyGroup !== echoGroup()) renderEchoBodies()
}
function resetEcho() {
  resetNodeTelemetry()
  S.echo.epoch++
  S.echo.entries = {}
  S.echo.pending = null
  resetPingTasks()
}
async function loadEcho(force = false) {
  // The overview and the Star Map share one cache and one 60 s batch; nothing else asks.
  const page = S.page === 'dashboard' || S.page === 'worldmap'
  if (S.echo.pending || !page || !S._loaded || document.hidden) return
  const wanted = S.page === 'worldmap' ? visible() : filtered(),
    now = Date.now(),
    missing = wanted.filter(n => force || !S.echo.entries[n.uuid] || now - S.echo.entries[n.uuid].at >= 60000)
  if (!missing.length) {
    updateEchoCaption()
    return
  }
  const epoch = S.echo.epoch,
    token = {}
  S.echo.pending = token
  renderEchoBodies()
  const updates = {}
  try {
    let bulk = false
    if (await hasMetricStore()) {
      try {
        const [ss, defs] = await Promise.all([
          queryMetrics(['ping.latency_ms', 'ping.loss'], { hours: 1, max: 60 }),
          pingTasks(),
        ])
        setEchoTaskDefs(defs)
        const visibleIds = new Set(visible().map(n => n.uuid)),
          by: Record<
            string,
            Record<number, { id: number; lat: MetricPoint[]; loss: MetricPoint[]; bucketSeconds: number }>
          > = {}
        ss.forEach(s => {
          if (!visibleIds.has(s.entity_id)) return
          const rawId = s.tags && s.tags.task_id
          if (rawId == null) return
          const id = Number(rawId)
          if (!Number.isFinite(id)) return
          const node = by[s.entity_id] || (by[s.entity_id] = {}),
            t = node[id] || (node[id] = { id, lat: [], loss: [], bucketSeconds: 0 })
          if (Number.isFinite(s.interval_seconds) && s.interval_seconds > 0)
            t.bucketSeconds = Math.max(t.bucketSeconds, s.interval_seconds)
          if (s.metric_key === 'ping.latency_ms') t.lat.push(...(s.points || []))
          if (s.metric_key === 'ping.loss') t.loss.push(...(s.points || []))
        })
        if (ss.length || defs.length) {
          visible().forEach(n => {
            const tasks = Object.values(by[n.uuid] || {})
              .map(t =>
                packEcho(
                  t.id,
                  (defs.find(d => Number(d.id) === t.id) || {}).name || 'Task ' + t.id,
                  t.lat,
                  t.loss,
                  now,
                  defs.find(d => Number(d.id) === t.id)?.interval || 60,
                  t.bucketSeconds,
                ),
              )
              .sort((a, b) => a.id - b.id)
            updates[n.uuid] = {
              at: now,
              tasks,
              configured: tasks.length > 0 || probesFor(defs, n.uuid),
              error: false,
            }
          })
          bulk = true
        }
      } catch (e) {}
    }
    if (!bulk) {
      const legacyDefs = new Map<number, PingTaskDef>()
      await pmap(
        missing,
        async n => {
          try {
            const data = await getJson('/api/records/ping?uuid=' + encodeURIComponent(n.uuid) + '&hours=1')
            const defs = data.tasks || []
            defs.forEach(t => legacyDefs.set(Number(t.id), t))
            const tasks = defs.map(t => {
              const rs = (data.records || []).filter(p => String(p.task_id) === String(t.id))
              return packEcho(
                t.id,
                t.name || 'Task ' + t.id,
                rs.map(p => ({ time: p.time, value: p.value })),
                rs
                  .filter(p => Number.isFinite(p.value))
                  .map(p => ({ time: p.time, value: p.value < 0 ? 1 : 0 })),
                now,
                t.interval || 60,
              )
            })
            updates[n.uuid] = { at: now, tasks, configured: !!defs.length, error: false }
          } catch (e) {
            const prev = S.echo.entries[n.uuid]
            updates[n.uuid] = {
              at: now,
              tasks: (prev && prev.tasks) || [],
              configured: (prev && prev.configured) || false,
              error: true,
            }
          }
        },
        2,
      )
      if (epoch === S.echo.epoch) setEchoTaskDefs([...legacyDefs.values()])
    }
    if (epoch === S.echo.epoch) {
      const allowed = new Set(visible().map(n => n.uuid))
      Object.keys(updates).forEach(id => {
        if (allowed.has(id)) S.echo.entries[id] = updates[id]
      })
    }
  } finally {
    if (S.echo.pending === token) {
      S.echo.pending = null
      renderEchoBodies()
    }
  }
}

/* Event wiring, called once from main after the views are mounted. */
function bindEcho() {
  document.addEventListener('visibilitychange', () =>
    document.hidden ? trendObserver?.disconnect() : syncEchoTrends(),
  )
  bindEchoPresets(renderEchoBodies, () => {
    resetEcho()
    void loadEcho(true)
  })
  $('echoRefresh').addEventListener('click', () => loadEcho(true))
}

export {
  bindEcho,
  resetEcho,
  echoCard,
  loadEcho,
  onEchoData,
  packEcho,
  syncEchoGroup,
  updateEchoCaption,
  updateEchoLive,
}
