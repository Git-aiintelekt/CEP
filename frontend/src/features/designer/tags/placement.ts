/** Where a popover goes, given the button it hangs off: below it, or above when the room below has run out. */

export const POPOVER_WIDTH = 320
export const POPOVER_MAX_HEIGHT = 360
const GAP = 4
const EDGE = 8

export interface Placement {
  left: number
  top?: number
  bottom?: number
  flipped: boolean
}

export function placePopover(anchor: DOMRect, viewport: { width: number; height: number }): Placement {
  const left = Math.max(EDGE, Math.min(anchor.left, viewport.width - POPOVER_WIDTH - EDGE))
  const roomBelow = viewport.height - anchor.bottom - GAP
  const roomAbove = anchor.top - GAP
  const flipped = roomBelow < POPOVER_MAX_HEIGHT && roomAbove > roomBelow
  return flipped ? { left, bottom: viewport.height - anchor.top + GAP, flipped } : { left, top: anchor.bottom + GAP, flipped }
}
