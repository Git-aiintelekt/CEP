/**
 * Margin and padding on one block, summed into the one spacing MJML has.
 *
 * MJML lays blocks out with padding alone and email clients drop CSS margins, so the email can only ever carry one
 * value per side. The designer keeps two: the margin (outside the block) and the padding (inside it), stored on the
 * component as `cep-spacing`, and writes their sum into the MJML `padding` attribute. A block that was never given a
 * margin has no `cep-spacing` and its padding attribute is read and written as before.
 *
 * Pure: no GrapesJS. The settings adapter reads and writes the component.
 */
import { EMPTY_PADDING, PADDING_SIDES, formatPadding, parsePadding, type Padding } from './fields/padding'

export const SPACING_PROP = 'cep-spacing'

export interface Spacing {
  /** the four sides as the padding field holds them ("10" = 10px, "5%"); null = no margin */
  margin: Padding | null
  /** the inner part; null = whatever the email gives the block (its own attribute, mj-attributes or MJML's default) */
  padding: Padding | null
}

/** "10" -> { amount: 10, unit: 'px' }; "5%" -> { amount: 5, unit: '%' }; '' counts as nothing. */
function sideOf(value: string): { amount: number; unit: 'px' | '%' } | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const match = /^(\d+(?:\.\d+)?)(%?)$/.exec(trimmed)
  return match ? { amount: Number(match[1]), unit: match[2] === '%' ? '%' : 'px' } : null
}

/**
 * The four sides the email gets: margin plus padding, side by side. null when a side mixes px and % (nothing
 * in an email can add those), which the field reports rather than writing something wrong.
 */
export function sumSpacing(margin: Padding | null, padding: Padding | null): Padding | null {
  const out: Padding = { ...EMPTY_PADDING }
  for (const side of PADDING_SIDES) {
    const a = sideOf(margin?.[side.key] ?? '')
    const b = sideOf(padding?.[side.key] ?? '')
    if (a && b && a.unit !== b.unit) return null
    const unit = a?.unit ?? b?.unit ?? 'px'
    const total = Math.round(((a?.amount ?? 0) + (b?.amount ?? 0)) * 1000) / 1000
    out[side.key] = unit === '%' ? `${total}%` : String(total)
  }
  return out
}

/** The MJML shorthand of the four sides, or null when a side is not a number. */
export function shorthand(sides: Padding | null): string | null {
  return sides ? formatPadding(sides.top, sides.right, sides.bottom, sides.left) : null
}

/** What a component holds, if anything; a value that is not the expected shape reads as nothing. */
export function spacingFrom(raw: unknown): Spacing | null {
  if (!raw || typeof raw !== 'object') return null
  const { margin, padding } = raw as { margin?: unknown; padding?: unknown }
  const m = typeof margin === 'string' ? parsePadding(margin) : null
  const p = typeof padding === 'string' ? parsePadding(padding) : null
  return m || p ? { margin: m, padding: p } : null
}

/** How the split is stored: two shorthands, so the saved design stays readable. */
export function spacingToStore(spacing: Spacing): { margin: string | null; padding: string | null } {
  return { margin: shorthand(spacing.margin), padding: shorthand(spacing.padding) }
}

export const ZERO_PADDING: Padding = { top: '0', right: '0', bottom: '0', left: '0' }
