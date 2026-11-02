import { lvl } from '../nodes/list'
import { S, thr, visible } from '../state'
import { $, daysLeft, esc, fB, pct } from '../utils/format'
import { metrics } from '../utils/metrics'

/* ── node list ── */
function watchInfo(n) {
  if (!S.lastSync) return null
  if (!S.online.has(n.uuid)) return { n, kind: 'offline', rank: 0, reason: '信号中断', value: '离线' }
  const m = metrics(n)
  for (const [key, label] of <['cpu' | 'ram' | 'disk', string][]>[
    ['cpu', 'CPU 高负载'],
    ['ram', '内存占用偏高'],
    ['disk', '磁盘占用偏高'],
  ])
    if (m[key] >= thr(key)) return { n, kind: key, rank: 1, reason: label, value: Math.round(m[key]) + '%' }
  const days = daysLeft(n.expired_at)
  if (days != null && days <= 15)
    return {
      n,
      kind: 'expiry',
      rank: 2,
      reason: days < 0 ? '已超过到期时间' : '续费提醒',
      value: days < 0 ? '已到期' : days === 0 ? '今日到期' : days + ' 天',
    }
  return null
}
function needsAttention(n) {
  return !!watchInfo(n)
}
function rOverview() {
  if (!$('fleetCpuLive')) return
  const vis = visible(),
    online = vis.filter(n => S.online.has(n.uuid)),
    ready = !!S.lastSync
  let cpu = 0,
    cores = 0,
    memU = 0,
    memT = 0,
    diskU = 0,
    diskT = 0
  online.forEach(n => {
    const m = metrics(n)
    cpu += m.cpu
    cores += +n.cpu_cores || 0
    memU += m.memU
    memT += m.memT
    diskU += m.diskU
    diskT += m.diskT
  })
  const values = {
    Cpu: online.length ? cpu / online.length : null,
    Ram: memT > 0 ? pct(memU, memT) : null,
    Disk: diskT > 0 ? pct(diskU, diskT) : null,
  }
  for (const [key, value] of Object.entries(values)) {
    $('fleet' + key + 'Live').innerHTML = ready && value != null ? value.toFixed(1) + '<small>%</small>' : '—'
    const bar = $('fleet' + key + 'Bar')
    bar.style.width = ready && value != null ? Math.max(0, Math.min(100, value)) + '%' : '0%'
    bar.className = value != null ? lvl(value, { Cpu: 'cpu', Ram: 'ram', Disk: 'disk' }[key]) : ''
  }
  $('overviewState').textContent = !ready
    ? 'CONNECTING'
    : S.connected
      ? 'LIVE / ' + online.length + ' 台在线'
      : 'LAST SNAPSHOT'
  $('fleetCpuCapacity').textContent =
    ready && online.length ? '在线节点均值 · ' + cores + ' vCPU' : '暂无在线节点数据'
  $('fleetRamCapacity').textContent =
    ready && memT > 0 ? fB(memU) + ' / ' + fB(memT) + ' · 在线节点' : '暂无在线节点数据'
  $('fleetDiskCapacity').textContent =
    ready && diskT > 0 ? fB(diskU) + ' / ' + fB(diskT) + ' · 在线节点' : '暂无在线节点数据'
  const items = vis
      .map(watchInfo)
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank),
    list = items.slice(0, 3),
    signature = list.map(x => x.n.uuid + ':' + x.kind).join('|') + ';' + ready + ';' + vis.length
  $('watchCount').textContent = ready ? items.length + ' 项' : '—'
  if (S._watchSignature !== signature) {
    S._watchSignature = signature
    $('watchList').innerHTML = list.length
      ? list
          .map(
            x =>
              `<a class="watch-row ${x.kind}" data-nav href="/detail/${encodeURIComponent(x.n.uuid)}"><span><span class="watch-name">${esc(x.n.name)}</span><span class="watch-reason">${esc(x.reason)}</span></span><span class="watch-value">${esc(x.value)}</span></a>`,
          )
          .join('')
      : `<div class="watch-empty">${!ready ? '等待首帧节点数据' : !vis.length ? '尚未添加节点' : '当前没有需要关注的节点'}</div>`
  } else
    document.querySelectorAll<HTMLElement>('#watchList .watch-row').forEach((el, i) => {
      el.querySelector<HTMLElement>('.watch-value').textContent = list[i].value
      el.querySelector<HTMLElement>('.watch-reason').textContent = list[i].reason
    })
  $('watchAll').hidden = !items.length
  $('watchAll').textContent = '查看全部 ' + items.length + ' 台 ↗'
}

export { needsAttention, rOverview }
