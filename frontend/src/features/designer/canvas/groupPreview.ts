/**
 * "Keep Side by Side" on the canvas at phone width.
 *
 * MJML keeps the columns of an mj-group beside each other on a phone by giving each its share as an inline width. The
 * plugin draws every column on its own, as a plain column — full width below 480px — so a grouped section stacked in
 * the phone preview while the sent email did not. The share is painted onto the frame's DOM as a custom property that
 * the skin applies at phone width; the component model, the MJML and the saved project are untouched, as with the
 * phone-width attribute itself.
 */
export const GROUP_WIDTH_PROPERTY = '--cep-group-width'

const GROUP = '[data-gjs-type="mj-group"]'
const COLUMN = '[data-gjs-type="mj-column"]'

/** The columns a group holds, not those of a group inside one of them. */
function columnsOf(group: Element): Element[] {
  return [...group.querySelectorAll(COLUMN)].filter((column) => column.parentElement?.closest(GROUP) === group)
}

/** Each column's share of the group: its own width when it has one, else an equal split of what the others leave. */
export function shares(widths: (string | null)[]): string[] {
  const own = widths.map((width) => {
    const match = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/.exec(width ?? '')
    return match ? Number(match[1]) : null
  })
  const taken = own.reduce<number>((total, width) => total + (width ?? 0), 0)
  const open = own.filter((width) => width === null).length
  const each = open === 0 ? 0 : Math.max(0, 100 - taken) / open
  return own.map((width) => `${Number((width ?? each).toFixed(4))}%`)
}

/** Paints every group's columns with their share. Re-applied whenever the frame is rebuilt or the design changes. */
export function paintGroupColumns(frame: Document | undefined | null): void {
  if (!frame) return
  for (const group of frame.querySelectorAll(GROUP)) {
    const columns = columnsOf(group)
    const widths = columns.map((column) => column.getAttribute('width'))
    shares(widths).forEach((share, index) => (columns[index] as HTMLElement).style.setProperty(GROUP_WIDTH_PROPERTY, share))
  }
}
