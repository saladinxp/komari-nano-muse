import { needsAttention, rOverview } from './console'
import { rOrbit } from './halo'
import { S, visible } from '../state'
import { $, fBp, fClock, fS } from '../utils/format'
import { metrics } from '../utils/metrics'

/* ── summary (hero chips + strip) ── */
function rSummary() {
  const vis = visible(),
    on = vis.filter(n => S.online.has(n.uuid))
  let tu = 0,
    td = 0,
    up = 0,
    dn = 0,
    cpu = 0
  vis.forEach(n => {
    const m = metrics(n)
    tu += m.tu
    td += m.td
    if (S.online.has(n.uuid)) {
      up += m.up
      dn += m.down
      cpu += m.cpu
    }
  })
  const off = vis.length - on.length,
    ready = !!S.lastSync
  $('rOn').innerHTML = ready
    ? on.length + '<small>/ ' + vis.length + '</small>'
    : '--<small>/ ' + vis.length + '</small>'
  const history = S.fleetAvg != null
  $('rCpu').innerHTML =
    (history ? S.fleetAvg.toFixed(1) : ready && on.length ? (cpu / on.length).toFixed(1) : '--') +
    '<small>%</small>'
  $('cpuLabel').textContent = history && S.fleetSource === 'sample' ? '抽样均载' : '平均负载'
  $('cpuPeriod').textContent = history ? 'CPU · 24H' : 'CPU · LIVE'
  $('rNet').innerHTML = ready
    ? '<span style="color:var(--blue)">↑</span>' +
      fS(up) +
      '<br><span style="color:var(--cyan)">↓</span>' +
      fS(dn)
    : '--'
  $('rTraffic').innerHTML = ready ? fBp(tu + td) : '--'
  const k = $('kicker')
  k.classList.toggle('off', ready && (!S.connected || off > 0))
  $('kickerTxt').textContent = !ready
    ? '等待实时连接'
    : !S.connected
      ? '连接中断 · 最后同步 ' + fClock(S.lastSync)
      : '最近同步 ' +
        fClock(S.lastSync) +
        ' · ' +
        vis.length +
        ' 台节点' +
        (!vis.length ? ' / 尚无节点' : off ? ' / ' + off + ' 台离线' : ' / 全部在线')
  const count = ready ? vis.filter(needsAttention).length : 0
  $('attentionBtn').hidden = !count
  $('attentionBtn').innerHTML = count + ' 台需要关注 <span aria-hidden="true">↗</span>'
  rOverview()
  rOrbit()
}

export { rSummary }
