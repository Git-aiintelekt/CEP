import { BARCODE_DEFAULTS, codeMjml, placeholderSrc } from './codes'
import type { CepBlock } from './types'

const SAMPLE = 'CPN400012345678'

/** A barcode drawn from each recipient's value when the email is sent: settings in the panel, never HTML. */
export const barcode: CepBlock = {
  id: 'barcode',
  label: 'Barcode',
  category: 'commerce',
  icon: 'Barcode',
  mjml: codeMjml(BARCODE_DEFAULTS, SAMPLE, placeholderSrc(BARCODE_DEFAULTS, SAMPLE)),
}
