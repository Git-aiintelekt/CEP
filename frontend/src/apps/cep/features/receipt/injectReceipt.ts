/**
 * Puts the rendered receipt into the compiled outer email, in place of the receipt slot's placeholder.
 *
 * The markers stay and only what lies between them is replaced, so the same HTML can be filled again for another
 * sample. They are matched loosely — any spacing inside the comment — so a compiler or formatter that re-spaces
 * comments cannot hide the slot. A design with no slot comes back unchanged: this renders, it does not validate.
 */
import { RECEIPT_SLOT_MARKER_END, RECEIPT_SLOT_MARKER_START } from '@/apps/cep/features/designer/blocks/receiptSlot'

/** "<!-- CEP:RECEIPT_SLOT_START -->" -> a pattern that allows any whitespace inside the comment */
function loose(marker: string): RegExp {
  const name = marker.replace(/^<!--\s*|\s*-->$/g, '')
  return new RegExp(`<!--\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*-->`, 'g')
}

const START = loose(RECEIPT_SLOT_MARKER_START)
const END = loose(RECEIPT_SLOT_MARKER_END)

export function injectReceiptIntoOuterHtml(outerHtml: string, receiptHtml: string): string {
  let result = ''
  let from = 0
  START.lastIndex = 0
  for (let start = START.exec(outerHtml); start; start = START.exec(outerHtml)) {
    const open = start.index + start[0].length
    END.lastIndex = open
    const end = END.exec(outerHtml)
    if (!end) break
    // sliced, not String.replace: a receipt is full of "$" amounts, which replace would read as patterns
    result += `${outerHtml.slice(from, open)}\n${receiptHtml}\n`
    from = end.index
    START.lastIndex = end.index + end[0].length
  }
  return from === 0 ? outerHtml : result + outerHtml.slice(from)
}
