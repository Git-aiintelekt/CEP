/** Reading and writing a single length. px and % are the only units MJML accepts; em, rem and a bare number are not. */
export type LengthUnit = 'px' | '%'

const NUMBER = /^-?\d*\.?\d+$/

export function isNumber(amount: string): boolean {
  return NUMBER.test(amount.trim())
}

export function lengthError(units: readonly LengthUnit[]): string {
  return `Use a number in ${units.join(' or ')}`
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
