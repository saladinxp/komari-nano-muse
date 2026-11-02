/* One shared hover / focus card for the Star Map and Ledger charts. Elements opt in
   with [data-tip]; the page supplies the card body. It is anchored to the element's
   box (above, or below when there is no room), so it never tracks the pointer and
   adds no work between events. */
let tip: HTMLDivElement | null = null
let anchor: Element | null = null
let globalBound = false

function el(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement('div')
    tip.className = 'nm-tip'
    tip.setAttribute('role', 'tooltip')
    tip.id = 'nmTip'
    tip.hidden = true
    document.body.appendChild(tip)
  }
  return tip
}
export function hideTip() {
  anchor?.removeAttribute('aria-describedby')
  anchor = null
  if (tip) tip.hidden = true
}
function show(target: Element, html: string) {
  const t = el()
  t.innerHTML = html
  t.hidden = false
  anchor = target
  target.setAttribute('aria-describedby', t.id)
  const r = target.getBoundingClientRect(),
    w = t.offsetWidth,
    h = t.offsetHeight,
    m = 8
  const left = Math.max(m, Math.min(innerWidth - w - m, r.left + r.width / 2 - w / 2))
  const above = r.top - h - 10
  t.style.left = left + 'px'
  t.style.top = (above >= m ? above : Math.min(innerHeight - h - m, r.bottom + 10)) + 'px'
}
/** Delegate hover and keyboard focus inside `root` to elements carrying [data-tip]. */
export function bindTips(root: HTMLElement, body: (target: HTMLElement) => string | null) {
  const open = (e: Event) => {
    const target = (e.target as Element).closest?.<HTMLElement>('[data-tip]')
    if (!target || !root.contains(target)) return
    if (target === anchor) return
    const html = body(target)
    if (html) show(target, html)
    else hideTip()
  }
  const close = (e: Event) => {
    const next = (e as FocusEvent | PointerEvent).relatedTarget as Element | null
    if (anchor && (!next || !anchor.contains(next))) hideTip()
  }
  root.addEventListener('pointerover', open)
  root.addEventListener('pointerout', close)
  root.addEventListener('focusin', open)
  root.addEventListener('focusout', close)
  if (!globalBound) {
    globalBound = true
    // Escape closes the card wherever focus is (hovering never moves focus); scrolling closes it too.
    addEventListener('keydown', e => e.key === 'Escape' && hideTip())
    addEventListener('scroll', hideTip, { passive: true })
  }
}
