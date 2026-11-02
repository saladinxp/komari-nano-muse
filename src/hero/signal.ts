/* 信号日志: the latest real events on the home page, in the observatory's plain
   voice. The same events drive the duty room's log and moments (cast/events.ts);
   only the wording differs. Idle notices are left out here as noise. */
import { dutyLog, onDutyEvent, SIGNAL_TAG } from '../cast/events'
import { S } from '../state'
import { $, esc, fClock } from '../utils/format'

const SHOWN = 5

export function rSignalLog(): void {
  const items = dutyLog()
    .filter(e => e.kind !== 'idle')
    .slice(0, SHOWN)
  const box = $('signalLog')
  box.hidden = !items.length
  if (!items.length) return
  $('signalList').innerHTML = items
    .map(e => {
      const [tag, tone] = SIGNAL_TAG[e.kind]
      return `<li><a href="/detail/${encodeURIComponent(e.uuid)}" data-nav><time class="num">${fClock(new Date(e.at))}</time><em class="sl-${tone}">${tag}</em><span>${esc(e.plain)}</span></a></li>`
    })
    .join('')
}

/* Event wiring, called once from main after the views are mounted. */
export function bindSignalLog(): void {
  onDutyEvent(() => S.page === 'dashboard' && rSignalLog())
}
