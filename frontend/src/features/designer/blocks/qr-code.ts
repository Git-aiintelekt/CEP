import { QR_DEFAULTS, codeMjml, placeholderSrc } from './codes'
import type { CepBlock } from './types'

const SAMPLE = 'https://shop.example.com/c/SAVE20-7K3Q'

/** A QR code drawn from each recipient's value when the email is sent: settings in the panel, never HTML. */
export const qrCode: CepBlock = {
  id: 'qr-code',
  label: 'QR Code',
  category: 'commerce',
  icon: 'QrCode',
  mjml: codeMjml(QR_DEFAULTS, SAMPLE, placeholderSrc(QR_DEFAULTS, SAMPLE)),
}
