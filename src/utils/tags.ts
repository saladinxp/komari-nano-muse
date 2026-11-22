/* Node tags as Komari stores them: one string split by ';', e.g. "10Gbps<green>;2T<blue>".
   A trailing <name> picks a colour, with the same rule and the same 26 names as Komari's
   default front end (komari-web src/components/PriceTags.tsx: /<(\w+)>$/, Radix colours);
   an unknown name stays part of the text. Untagged labels keep the theme's quiet style.
   Colours are Radix step 11 (text on a soft background), light / dark. */

export const TAG_COLORS: Record<string, [string, string]> = {
  ruby: ['#ca244d', '#ff949d'],
  gray: ['#646464', '#b4b4b4'],
  gold: ['#71624b', '#cbb99f'],
  bronze: ['#7d5e54', '#d4b3a5'],
  brown: ['#815e46', '#dbb594'],
  yellow: ['#9e6c00', '#f5e147'],
  amber: ['#ab6400', '#ffca16'],
  orange: ['#cc4e00', '#ff801f'],
  tomato: ['#d13415', '#ff977d'],
  red: ['#ce2c31', '#ff9592'],
  crimson: ['#cb1d63', '#ff92ad'],
  pink: ['#c2298a', '#ff8dcc'],
  plum: ['#953ea3', '#e796f3'],
  purple: ['#8145b5', '#d19dff'],
  violet: ['#6550b9', '#baa7ff'],
  iris: ['#5753c6', '#b1a9ff'],
  indigo: ['#3a5bc7', '#9eb1ff'],
  blue: ['#0d74ce', '#70b8ff'],
  cyan: ['#107d98', '#4ccce6'],
  teal: ['#008573', '#0bd8b6'],
  jade: ['#208368', '#1fd8a4'],
  green: ['#218358', '#3dd68c'],
  grass: ['#2a7e3b', '#71d083'],
  lime: ['#5c7c2f', '#d4ff70'],
  mint: ['#027864', '#58d5ba'],
  sky: ['#00749e', '#75c7f0'],
}

export interface NodeTag {
  text: string
  /** Komari colour name, or null for a plain tag. */
  color: string | null
}

/** Split and parse a node's tags. Also accepts ',' and full-width separators, as before. */
export function parseTags(raw: string | null | undefined): NodeTag[] {
  return (raw || '')
    .split(/[;,，；]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(tag => {
      const m = tag.match(/<(\w+)>$/),
        color = m && m[1].toLowerCase()
      if (color && TAG_COLORS[color]) {
        const text = tag.slice(0, -m[0].length).trim()
        return { text: text || tag, color: text ? color : null }
      }
      return { text: tag, color: null }
    })
}

/** Inline custom properties for a coloured tag: its light and dark text colours. */
export function tagStyle(t: NodeTag): string {
  if (!t.color) return ''
  const [light, dark] = TAG_COLORS[t.color]
  return `--tag-light:${light};--tag-dark:${dark}`
}
