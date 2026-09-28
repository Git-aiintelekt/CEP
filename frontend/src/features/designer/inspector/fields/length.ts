/**
 * Reading and writing a single length. px and % are the only units MJML accepts; em and rem are offered as a way of
 * typing and become px the moment the value is written (rem from a 16px base, em from the block's own font size).
 * vh and vw have no meaning inside an email, which has no viewport, so they are not offered.
 */
export type LengthUnit = 'px' | '%'
/** typed in one of these, the value is written in px */
export type TypedUnit = LengthUnit | 'em' | 'rem'

export const CONVERTIBLE_UNITS: readonly TypedUnit[] = ['em', 'rem']
export const REM_BASE = 16
/** MJML's own text size, which is what em means on a block that sets no font size of its own */
export const DEFAULT_EM_BASE = 13

const NUMBER = /^-?\d*\.?\d+$/

export function isNumber(amount: string): boolean {
  return NUMBER.test(amount.trim())
}

export function lengthError(units: readonly LengthUnit[]): string {
  return `Use a number in ${units.join(' or ')}${units.includes('px') ? ', or em / rem (written as px)' : ''}`
}

/** "15px" -> { amount: '15', unit: 'px' }. Anything with another unit, or none, is not editable here. */
export function splitLength(value: string | null | undefined, units: readonly LengthUnit[]): { amount: string; unit: LengthUnit } | null {
  const trimmed = String(value ?? '').trim()
  for (const unit of units) {
    if (!trimmed.endsWith(unit)) continue
    const amount = trimmed.slice(0, -unit.length)
    if (NUMBER.test(amount)) return { amount, unit }
  }
  return null
}

/** The units the picker offers: what MJML accepts, plus em and rem wherever px is one of them. */
export function offeredUnits(units: readonly LengthUnit[]): readonly TypedUnit[] {
  return units.includes('px') ? [...units, ...CONVERTIBLE_UNITS] : units
}

/** A number in em or rem as the px the email gets: 1.5em at a 13px font is 19.5px. Two decimals at most. */
export function toPx(amount: number, unit: TypedUnit, emBase: number = DEFAULT_EM_BASE): number {
  const base = unit === 'rem' ? REM_BASE : unit === 'em' ? emBase : 1
  return Math.round(amount * base * 100) / 100
}

/** A px amount as em or rem, for showing a value in the unit someone has just picked: 19.5px at 13px is 1.5em. */
export function fromPx(px: number, unit: TypedUnit, emBase: number = DEFAULT_EM_BASE): number {
  const base = unit === 'rem' ? REM_BASE : unit === 'em' ? emBase : 1
  return Math.round((px / base) * 1000) / 1000
}

/** What the email gets for a typed amount and unit: "1.5em" -> "19.5px", "50%" -> "50%", "12px" -> "12px". */
export function written(amount: string, unit: TypedUnit, emBase: number = DEFAULT_EM_BASE): string {
  const number = Number(amount.trim())
  if (unit === 'em' || unit === 'rem') return `${toPx(number, unit, emBase)}px`
  return `${amount.trim()}${unit}`
}
