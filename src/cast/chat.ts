/* A visit between colleagues: who says what, and when. Pure functions of time and
   a roll, so the duty room only has to place the two people and show the bubbles.

   Both stay facing the viewer while resting (docs/idle-behavior-update-v2.md); a
   host who is working keeps typing with their back to us and answers over the
   shoulder. Lines take turns, one bubble at a time. */

export type ChatRole = 'guest' | 'host'

export interface ChatLine {
  by: ChatRole
  text: string
}

/** How long each line stays up, in ms. */
export const LINE_MS = 2600

/** What the host is doing when the guest arrives: resting and free, working normally,
    under load (busy / alert / call), off on an errand, or offline (asleep at the desk). */
export type HostState = 'idle' | 'work' | 'busy' | 'away' | 'asleep'

export interface ChatFacts {
  host: HostState
  /** Host's character name, used to call them. */
  name: string
  /** Host node's CPU %, live. */
  cpu: number
  /** Host node's uptime in days. */
  days: number
}

/** The visit's lines, from a roll in [0, 1). Topics touch the host's real data. */
export function chatScript(f: ChatFacts, roll: number): ChatLine[] {
  const g = (text: string): ChatLine => ({ by: 'guest', text }),
    h = (text: string): ChatLine => ({ by: 'host', text })
  if (f.host === 'away') return [g(`${f.name}不在啊……`)]
  if (f.host === 'asleep') return [g('睡着了？嘘……')]
  if (f.host === 'busy') return [h('别闹，正忙着呢！'), g('好好好，我撤。')]
  const topics: ChatLine[][] =
    f.host === 'work'
      ? [
          [g(`${f.name}，忙着呢？`), h('在跑任务，晚点聊。')],
          [g('要帮忙吗？'), h('不用，马上就好。'), g('那我不打扰啦。')],
          [g('中午吃啥？'), h('等我跑完这批。')],
        ]
      : [
          [g('今天好清闲啊。'), h('嘘，别让领导听见。')],
          [g(`你那台 CPU 才 ${Math.max(1, Math.round(f.cpu))}%？`), h('低功耗运行中～')],
          [g('下午茶喝什么？'), h('老规矩，美式。'), g('我请！')],
          ...(f.days >= 30 ? [[g(`你这台跑了 ${Math.floor(f.days)} 天了吧？`), h('稳得很。')]] : []),
        ]
  return topics[Math.min(topics.length - 1, Math.floor(roll * topics.length))]
}

/** Said when the host gets work in the middle of a chat. */
export const INTERRUPTED: readonly ChatLine[] = [
  { by: 'host', text: '来活了，回头聊！' },
  { by: 'guest', text: '那我先撤～' },
]

/** Total length of a chat, in ms. */
export const chatMs = (lines: readonly ChatLine[]): number => lines.length * LINE_MS

/** The line being said `elapsed` ms into the chat, or null once it is over. */
export function chatAt(
  lines: readonly ChatLine[],
  elapsed: number,
): { index: number; line: ChatLine } | null {
  if (elapsed < 0) return null
  const index = Math.floor(elapsed / LINE_MS)
  return index < lines.length ? { index, line: lines[index] } : null
}
