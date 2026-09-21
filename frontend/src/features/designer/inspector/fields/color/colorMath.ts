/** Colour conversion and WCAG contrast. Pure: no React, no DOM. */

export interface Hsv {
  /** 0-360 */
  h: number
  /** 0-100 */
  s: number
  /** 0-100 */
  v: number
}

/**
 * #abc, #AABBCC, abc, AABBCC -> #aabbcc. Six-digit lowercase is the one colour format the browser compiler
 * and the server's renderer cannot disagree about. Anything else — rgb(), a name, four digits — is null.
 */
export function normaliseHex(input: string | null | undefined): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(input ?? '').trim())
  if (!match) return null
  const digits = match[1]
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits
  return `#${full.toLowerCase()}`
}

function channels(hex: string): [number, number, number] | null {
  const normalised = normaliseHex(hex)
  if (normalised === null) return null
  return [
    parseInt(normalised.slice(1, 3), 16),
    parseInt(normalised.slice(3, 5), 16),
    parseInt(normalised.slice(5, 7), 16),
  ]
}

export function hexToHsv(hex: string): Hsv | null {
  const rgb = channels(hex)
  if (rgb === null) return null
  const [red, green, blue] = rgb.map((channel) => channel / 255)

  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const span = max - min

  let hue = 0
  if (span !== 0) {
    if (max === red) hue = ((green - blue) / span) % 6
    else if (max === green) hue = (blue - red) / span + 2
    else hue = (red - green) / span + 4
    hue *= 60
    if (hue < 0) hue += 360
  }

  return { h: Math.round(hue), s: Math.round(max === 0 ? 0 : (span / max) * 100), v: Math.round(max * 100) }
}

export function hsvToHex(h: number, s: number, v: number): string {
  const hue = ((h % 360) + 360) % 360
  const saturation = clamp(s, 0, 100) / 100
  const value = clamp(v, 0, 100) / 100

  const chroma = value * saturation
  const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const lift = value - chroma

  const sector = Math.floor(hue / 60) % 6
  const rgb =
    sector === 0 ? [chroma, second, 0]
    : sector === 1 ? [second, chroma, 0]
    : sector === 2 ? [0, chroma, second]
    : sector === 3 ? [0, second, chroma]
    : sector === 4 ? [second, 0, chroma]
    : [chroma, 0, second]

  return `#${rgb.map((channel) => Math.round((channel + lift) * 255).toString(16).padStart(2, '0')).join('')}`
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number | null {
  const rgb = channels(hex)
  if (rgb === null) return null
  const [red, green, blue] = rgb.map((channel) => {
    const part = channel / 255
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/** WCAG contrast, 1 to 21. null when either colour is not a hex we understand. */
export function contrastRatio(a: string, b: string): number | null {
  const first = luminance(a)
  const second = luminance(b)
  if (first === null || second === null) return null
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

export const READABLE_CONTRAST = 4.5

/** True only when both colours are known and the pair falls below the WCAG AA body-text ratio. */
export function isHardToRead(text: string, background: string): boolean {
  const ratio = contrastRatio(text, background)
  return ratio !== null && ratio < READABLE_CONTRAST
}
