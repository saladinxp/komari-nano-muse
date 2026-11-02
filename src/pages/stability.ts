import { getJson, hasMetricStore, pingTasks, pmap, queryMetrics } from '../api/client'
import { HOURS } from './detail'
import { S, visible } from '../state'
import { $, esc, fMs, regionCode } from '../utils/format'

/* ══ stability matrix ══ */
const SB = 48
function openStab() {
  const hs = HOURS.filter(h => h[0] >= 6 && h[0] <= Math.max(S.pingHours, 6) && h[0] <= 168)
  $('stHours').innerHTML = hs
    .map(h => `<button data-h="${h[0]}" class="${h[0] === S.stab.hours ? 'on' : ''}">${h[1]}</button>`)
    .join('')
  loadStab()
}
async function loadStab() {
  const key = S.stab.hours
  if (S.stab.cache[key] && Date.now() - S.stab.cache[key].at < 120000) {
    rStab()
    return
  }
  $('stBody').innerHTML = '<div class="empty">LOADING · 正在汇总拨测数据</div>'
  $('stTasks').innerHTML = ''
  const vis = visible(),
    hours = key,
    now = Date.now(),
    span = hours * 3600e3
  const rows = {}
  let tasks = []
  const bucket = () => ({ lat: new Array(SB).fill(null), loss: new Array(SB).fill(null) })
  let ok = false
  if (await hasMetricStore()) {
    try {
      const [ss, defs] = await Promise.all([
        queryMetrics(['ping.latency_ms', 'ping.loss'], { hours, max: SB }),
        pingTasks(),
      ])
      const seen = new Set<number>()
      ss.forEach(s => {
        const id = Number(s.tags && s.tags.task_id),
          u = s.entity_id
        if (!isFinite(id) || !u) return
        seen.add(id)
        rows[u] = rows[u] || {}
        const r = (rows[u][id] = rows[u][id] || bucket())
        const pts = s.points || []
        for (let i = 0; i < SB; i++) {
          const p = pts[Math.min(pts.length - 1, Math.floor((i * pts.length) / SB))]
          if (!p) continue
          if (s.metric_key === 'ping.latency_ms') r.lat[i] = p.value
          else r.loss[i] = p.value == null ? null : p.value * 100
        }
      })
      tasks = [...seen]
        .sort((a, b) => a - b)
        .map(id => ({ id, name: defs.find(d => d.id === id)?.name || 'Task ' + id }))
      ok = tasks.length > 0
    } catch (e) {}
  }
  if (!ok) {
    const seen = {}
    let done = 0
    await pmap(
      vis,
      async n => {
        const d = await getJson('/api/records/ping?uuid=' + encodeURIComponent(n.uuid) + '&hours=' + hours)
        ;(d.tasks || []).forEach(t => (seen[t.id] = t.name))
        const acc = {}
        ;(d.records || []).forEach(r => {
          const i = Math.floor(((+new Date(r.time) - (now - span)) / span) * SB)
          if (i < 0 || i >= SB) return
          const a = (acc[r.task_id] = acc[r.task_id] || {
            s: new Array(SB).fill(0),
            c: new Array(SB).fill(0),
            f: new Array(SB).fill(0),
          })
          if (r.value >= 0) {
            a.s[i] += r.value
            a.c[i]++
          } else a.f[i]++
        })
        rows[n.uuid] = {}
        for (const id in acc) {
          const a = acc[id],
            b = bucket()
          for (let i = 0; i < SB; i++) {
            const t = a.c[i] + a.f[i]
            if (t) {
              b.lat[i] = a.c[i] ? a.s[i] / a.c[i] : null
              b.loss[i] = (a.f[i] / t) * 100
            }
          }
          rows[n.uuid][id] = b
        }
        done++
        if (S.page === 'stability')
          $('stBody').innerHTML = `<div class="empty">LOADING · ${done} / ${vis.length}</div>`
      },
      2,
    )
    tasks = Object.keys(seen)
      .map(Number)
      .sort((a, b) => a - b)
      .map(id => ({ id, name: seen[id] }))
  }
  S.stab.cache[key] = { at: Date.now(), rows, tasks }
  rStab()
}
function rStab() {
  const c = S.stab.cache[S.stab.hours]
  if (!c) return
  if (!c.tasks.length) {
    $('stBody').innerHTML = '<div class="empty">尚未配置拨测任务</div>'
    $('stTasks').innerHTML = ''
    return
  }
  if (!c.tasks.some(t => t.id === S.stab.task)) S.stab.task = c.tasks[0].id
  $('stTasks').innerHTML = c.tasks
    .map(t => `<button data-t="${t.id}" class="${t.id === S.stab.task ? 'on' : ''}">${esc(t.name)}</button>`)
    .join('')
  const vis = visible()
  let good = 0,
    warn = 0,
    bad = 0
  const body = vis
    .map((n, i) => {
      const r = c.rows[n.uuid] && c.rows[n.uuid][S.stab.task]
      if (!r)
        return `<tr data-href="/detail/${encodeURIComponent(n.uuid)}"><td class="nm">${esc(n.name)}</td><td colspan="4" style="color:var(--ink4)">--</td><td class="strip-c"><div class="hs">${'<i></i>'.repeat(SB)}</div></td></tr>`
      const lat = r.lat.filter(v => v != null),
        ls = r.loss.filter(v => v != null)
      const avg = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null,
        loss = ls.length ? ls.reduce((a, b) => a + b, 0) / ls.length : null
      const sorted = [...lat].sort((a, b) => a - b),
        med = sorted[Math.floor(sorted.length / 2)] || 0,
        top = sorted[Math.floor(sorted.length * 0.98)] || sorted[sorted.length - 1]
      const cells = r.lat
        .map((v, k) => {
          const l = r.loss[k]
          if (v == null && l == null) return '<i></i>'
          const cls =
            (l != null && l >= 5) || v == null
              ? 'b'
              : (l != null && l > 0.5) || (med && v > med * 1.8 && v - med > 15)
                ? 'w'
                : 'g'
          cls === 'g' ? good++ : cls === 'w' ? warn++ : bad++
          const hgt = v == null ? 100 : Math.round(28 + 72 * Math.min(1, v / (top || 1)))
          return `<i class="${cls}" style="height:${hgt}%" title="${fMs(v)} · ${l != null ? l.toFixed(1) : '--'}%"></i>`
        })
        .join('')
      return `<tr data-href="/detail/${encodeURIComponent(n.uuid)}"><td class="nm"><span class="dot${S.online.has(n.uuid) ? '' : ' off'}"></span>${esc(n.name)}</td><td>${fMs(avg)}</td><td>${lat.length ? fMs(sorted[0]) + ' / ' + fMs(sorted[sorted.length - 1]) : '--'}</td><td style="color:${loss >= 5 ? 'var(--coral)' : loss > 0.5 ? 'var(--amber)' : 'inherit'}">${loss != null ? loss.toFixed(2) + '%' : '--'}</td><td>${esc(regionCode(n.region))}</td><td class="strip-c"><div class="hs">${cells}</div></td></tr>`
    })
    .join('')
  $('stBody').innerHTML =
    `<table class="mx"><thead><tr><th>NODE</th><th>AVG</th><th>MIN / MAX</th><th>LOSS</th><th>REGION</th><th>${S.stab.hours}H · ${SB} SLICES</th></tr></thead><tbody>${body}</tbody></table>`
  const tot = good + warn + bad
  $('stMeta').innerHTML =
    `<span>TASK<b>${esc((c.tasks.find(t => t.id === S.stab.task) || {}).name || '')}</b></span><span>WINDOW<b>${S.stab.hours}H</b></span><span>HEALTHY<b>${tot ? ((good / tot) * 100).toFixed(1) : '--'}%</b></span><span>JITTER<b>${warn}</b></span><span>LOSS<b>${bad}</b></span>`
}

/* Event wiring, called once from main after the views are mounted. */
function bindStability() {
  $('stHours').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    S.stab.hours = +b.dataset.h
    openStab()
  })
  $('stTasks').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button')
    if (!b) return
    S.stab.task = +b.dataset.t
    rStab()
  })
}

export { bindStability, openStab, rStab }
