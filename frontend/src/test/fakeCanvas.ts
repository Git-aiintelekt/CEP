/** The state the fake Outer design canvas keeps, which the tests read and steer. */
import { RECEIPT_SLOT_MARKER_END, RECEIPT_SLOT_MARKER_START } from '@/apps/cep/features/designer/blocks/receiptSlot'

/** What the tests read and steer: how often the canvas mounted, and the MJML it holds. */
export const fakeCanvas = { mounts: 0, mjml: '', loaded: [] as unknown[] }

export function resetFakeCanvas() {
  fakeCanvas.mounts = 0
  fakeCanvas.mjml = ''
  fakeCanvas.loaded = []
}

/** The compiled email, with the slot the receipt goes into, and a footer only when the MJML has one. */
export function fakeCompiled(mjml: string): string {
  const footer = /cep-(receipt-)?footer/.test(mjml) ? '<p>Your company, 1 Example Street</p>' : ''
  return `<html><head><title>x</title></head><body><h1>YOUR BRAND</h1>${RECEIPT_SLOT_MARKER_START}<p>placeholder</p>${RECEIPT_SLOT_MARKER_END}${footer}</body></html>`
}
