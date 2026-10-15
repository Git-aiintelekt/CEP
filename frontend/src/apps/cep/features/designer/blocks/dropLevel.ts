import type { CepBlock } from './types'

export type DropLevel = 'section' | 'column' | 'raw'

/**
 * Where a block belongs: beside the sections (a section, a wrapper), inside somebody else's mj-column, or, for raw HTML
 * (Custom HTML, a barcode, a QR code), wherever the selection is: a column when one is chosen, else beside the sections.
 */
export function dropLevel(block: CepBlock): DropLevel {
  if (/^\s*<mj-raw[\s>]/.test(block.mjml)) return 'raw'
  return /^\s*<mj-(section|wrapper)[\s>]/.test(block.mjml) ? 'section' : 'column'
}
