/* The duty-room cast: eight original SD characters from 摸鱼机房 v4.

   Frame rectangles are [x, y, w, h] in the *source* atlas pixels
   (vendor/server-breakroom/dist/character-roster.mjs). The shipped atlases in
   public/scene-art/ are downscaled by ATLASES[*].scale (scripts/scene-art.py), so
   frames are multiplied by that factor when drawn.

   A node's character is presentation only: it never changes the node's data.
   Bindings are saved per node UUID in this browser. */
import type { KomariNode } from '../types/komari'
import { store } from '../utils/format'

export type Pose = 'idle' | 'work' | 'coffee' | 'sleep'
type Quad = [number, number, number, number]

export interface Atlas {
  art: string
  /** Shipped atlas size ÷ source atlas size. */
  scale: number
}

export interface Character {
  key: string
  name: string
  personality: string
  quote: string
  /** Accent used for the name tag. */
  color: string
  atlas: keyof typeof ATLASES
  frames: Record<Pose, Quad>
  /** Replies when poked (decoration only). */
  poke: string[]
  coffee: string
}

/* Keep in sync with ATLASES in scripts/scene-art.py. */
export const ATLASES = {
  trio: { art: 'cast-trio', scale: 0.82 },
  aoi: { art: 'cast-aoi', scale: 0.5 },
  chestnut: { art: 'cast-chestnut', scale: 0.5 },
  yuzu: { art: 'cast-yuzu', scale: 0.5 },
  seina: { art: 'cast-seina', scale: 0.5 },
  wheat: { art: 'cast-wheat', scale: 0.5 },
} satisfies Record<string, Atlas>

const frames = (idle: Quad, work: Quad, coffee: Quad, sleep: Quad) => ({ idle, work, coffee, sleep })

export const CHARACTERS: Character[] = [
  {
    key: 'blue',
    name: '小蓝',
    personality: '稳重的老员工',
    quote: '我没有摸鱼，我在等请求。',
    color: '#86abc2',
    atlas: 'trio',
    frames: frames([95, 8, 235, 391], [91, 399, 239, 387], [93, 786, 239, 374], [79, 1160, 259, 282]),
    poke: ['收到，别戳了。', '再戳就要收维护费了。', '我真的在工作。'],
    coffee: '谢谢，温度刚好。',
  },
  {
    key: 'orange',
    name: '阿橘',
    personality: '咖啡续命选手',
    quote: '忙完这一波，绝对去休息。',
    color: '#e3af70',
    atlas: 'trio',
    frames: frames([438, 5, 205, 397], [435, 402, 225, 390], [442, 792, 199, 375], [425, 1167, 250, 272]),
    poke: ['咖啡呢？怎么只有手指。', '啊！差点按了两遍回车。', '这个请求马上好。'],
    coffee: '活过来了！',
  },
  {
    key: 'mint',
    name: '薄荷',
    personality: '资深摸鱼专家',
    quote: '低功耗，是我的工作态度。',
    color: '#a8c2a0',
    atlas: 'trio',
    frames: frames([761, 8, 265, 395], [766, 404, 267, 388], [761, 792, 273, 371], [767, 1163, 273, 278]),
    poke: ['被发现了……', '我在进行低功耗测试。', '你也来摸鱼？'],
    coffee: '喝完这杯再睡。',
  },
  {
    key: 'aoi',
    name: '小葵',
    personality: '元气气氛组',
    quote: '今天也要热热闹闹地开工！',
    color: '#e9a09b',
    atlas: 'aoi',
    frames: frames([176, 2, 363, 621], [751, 4, 384, 618], [173, 629, 376, 616], [724, 723, 437, 506]),
    poke: ['收到！还有什么好玩的？', '你也来一起上班呀！', '嘿，吓我一跳！'],
    coffee: '谢谢！这杯香气满分！',
  },
  {
    key: 'chestnut',
    name: '阿栗',
    personality: '细心的技术员',
    quote: '让我把日志再看一遍。',
    color: '#8897bd',
    atlas: 'chestnut',
    frames: frames([161, 7, 355, 653], [720, 10, 370, 653], [190, 660, 345, 588], [693, 774, 396, 466]),
    poke: ['嗯？日志里没写这一步。', '等一下，我记个检查项。', '你发现什么问题了吗？'],
    coffee: '谢谢，正好配这份日志。',
  },
  {
    key: 'yuzu',
    name: '柚子',
    personality: '爱玩的游戏迷',
    quote: '这个任务算每日委托吗？',
    color: '#d6b46e',
    atlas: 'yuzu',
    frames: frames([152, 11, 394, 644], [664, 15, 433, 641], [163, 659, 420, 611], [658, 762, 422, 487]),
    poke: ['谁打断了我的连招！', '这是隐藏互动吗？', '再戳一次，有奖励吗？'],
    coffee: '能量条回满，继续下一关！',
  },
  {
    key: 'seina',
    name: '星奈',
    personality: '认真的值班班长',
    quote: '工位可以乱，备份不可以。',
    color: '#b29ac7',
    atlas: 'seina',
    frames: frames([192, 8, 443, 658], [740, 5, 455, 669], [167, 666, 459, 581], [720, 786, 467, 454]),
    poke: ['嗯？先把手上的事做好。', '有事直接告诉我就好。', '我才没有偷偷摸鱼。'],
    coffee: '谢谢……正好有点困。',
  },
  {
    key: 'wheat',
    name: '小麦',
    personality: '慢热的夜猫子',
    quote: '我只是闭眼整理一下思路。',
    color: '#a5aeba',
    atlas: 'wheat',
    frames: frames([220, 3, 338, 627], [717, 9, 342, 618], [211, 632, 342, 613], [681, 777, 429, 464]),
    poke: ['嗯……已经天亮了吗？', '我听到了，再让我缓一下。', '这个唤醒方式有点突然。'],
    coffee: '热的就好，夜还长着呢。',
  },
]

const BY_KEY = new Map(CHARACTERS.map(c => [c.key, c]))
const STORE_KEY = 'duty-cast'

/** UUID → character key, validated against the roster. */
function readBindings(): Record<string, string> {
  try {
    const v = JSON.parse(store.get(STORE_KEY, '{}'))
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).filter(([id, k]) => id && BY_KEY.has(k as string))) as Record<
      string,
      string
    >
  } catch (e) {
    return {}
  }
}
let bindings = readBindings()
const save = () => store.set(STORE_KEY, JSON.stringify(bindings))

/** Stable small hash so first assignments do not depend on list order alone. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** Give every node a character and remember it. New nodes get the character least
    used in their own group (so each room looks varied), then least used overall. */
export function castNodes(nodes: KomariNode[]): void {
  const inGroup = new Map<string, Map<string, number>>(),
    overall = new Map<string, number>()
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1)
  const groupOf = (n: KomariNode) => {
    const g = (n.group || '').trim()
    if (!inGroup.has(g)) inGroup.set(g, new Map())
    return inGroup.get(g)
  }
  nodes.forEach(n => {
    const k = bindings[n.uuid]
    if (k) {
      bump(groupOf(n), k)
      bump(overall, k)
    }
  })
  let changed = false
  nodes.forEach(n => {
    if (bindings[n.uuid]) return
    const g = groupOf(n),
      start = hash(n.uuid) % CHARACTERS.length
    let best = null,
      score = Infinity
    for (let i = 0; i < CHARACTERS.length; i++) {
      const c = CHARACTERS[(start + i) % CHARACTERS.length],
        s = (g.get(c.key) || 0) * 1000 + (overall.get(c.key) || 0)
      if (s < score) {
        score = s
        best = c
      }
    }
    bindings[n.uuid] = best.key
    bump(g, best.key)
    bump(overall, best.key)
    changed = true
  })
  if (changed) save()
}

export function characterOf(uuid: string): Character {
  return BY_KEY.get(bindings[uuid]) || CHARACTERS[hash(uuid) % CHARACTERS.length]
}

/** Manual choice from the picker; only changes appearance. */
export function setCharacter(uuid: string, key: string): void {
  if (!BY_KEY.has(key)) throw new RangeError('unknown character ' + key)
  bindings = { ...readBindings(), [uuid]: key }
  save()
}
