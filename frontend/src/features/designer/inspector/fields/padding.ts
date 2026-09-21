/** MJML padding shorthand, both ways. Pure: no React. px only, which is the one unit that is always safe. */

export interface Padding {
  top: string
  right: string
  bottom: string
  left: string
}

/** A number with the unit MJML accepts here, as it appears in an input: "10" or "10%" rather than "10px". */
const WITH_UNIT = /^(\d+(?:\.\d+)?)(px|%)$/
const BARE = /^\d+(?:\.\d+)?%?$/

/** "10px" -> "10"; "10%" stays "10%", since the per cent has to survive the round trip. */
function side(part: string): string | null {
  const match = WITH_UNIT.exec(part)
  if (!match) return null
  return match[2] === '%' ? `${match[1]}%` : match[1]
}

/** "10" -> "10px"; "10%" -> "10%". */
function written(amount: string): string {
  return amount.endsWith('%') ? amount : `${amount}px`
}

/**
 * "10px" / "10px 20px" / "10px 20px 30px" / "10px 20px 30px 40px" -> the four sides, px as a bare number and
 * per cent keeping its sign. Another unit, a missing unit or a fifth value is not something we can edit: null.
 */
export function parsePadding(value: string | null | undefined): Padding | null {
  const parts = String(value ?? '').trim().split(/\s+/).filter((part) => part !== '')
  if (parts.length === 0 || parts.length > 4) return null

  const sides = parts.map(side)
  if (sides.some((part) => part === null)) return null
  const [a, b, c, d] = sides as string[]

  if (parts.length === 1) return { top: a, right: a, bottom: a, left: a }
  if (parts.length === 2) return { top: a, right: b, bottom: a, left: b }
  if (parts.length === 3) return { top: a, right: b, bottom: c, left: b }
  return { top: a, right: b, bottom: c, left: d }
}

/**
 * The four sides -> the shortest shorthand MJML accepts, of one, two or four values. null when a side is not a
 * number, which is the field's cue to show an error rather than write something MJML will reject.
 */
export function formatPadding(top: string, right: string, bottom: string, left: string): string | null {
  const sides = [top, right, bottom, left].map((part) => {
    const trimmed = part.trim()
    return BARE.test(trimmed) ? trimmed : null
  })
  if (sides.some((part) => part === null)) return null
  const [t, r, b, l] = (sides as string[]).map(written)

  // one, two or four values only: the three-value form reads as a typo far more often than it reads as intent
  if (t === r && r === b && b === l) return t
  if (t === b && r === l) return `${t} ${r}`
  return `${t} ${r} ${b} ${l}`
}

export const EMPTY_PADDING: Padding = { top: '', right: '', bottom: '', left: '' }

export const PADDING_SIDES = [
  { key: 'top', label: 'Top padding', letter: 'T' },
  { key: 'right', label: 'Right padding', letter: 'R' },
  { key: 'bottom', label: 'Bottom padding', letter: 'B' },
  { key: 'left', label: 'Left padding', letter: 'L' },
] as const

export type PaddingSide = (typeof PADDING_SIDES)[number]['key']
