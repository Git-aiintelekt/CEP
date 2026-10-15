/** Where a receipt's return barcode image lives: GET /api/v1/public/barcode/<number>.png on this installation, a Code 128 of the number. */
import { API_BASE_URL } from '@/lib/config'

export function barcodeUrl(text: string): string {
  const base = /^https?:/i.test(API_BASE_URL) ? API_BASE_URL : `${window.location.origin}${API_BASE_URL}`
  return `${base}/public/barcode/${encodeURIComponent(text)}.png`
}
