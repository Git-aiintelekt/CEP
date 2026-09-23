/**
 * Which tools the canvas toolbar shows inline and which fold into its More menu.
 *
 * Decided by measurement: the component renders every tier once, hidden, and measures what each one actually
 * comes to — gaps, segmented devices and the zoom label included — so nothing here has to reconstruct widths.
 */

export type ToolId =
  | 'undo' | 'redo' | 'zoomOut' | 'zoom' | 'zoomIn' | 'desktop' | 'tablet' | 'mobile'
  | 'outlines' | 'preview' | 'fullscreen' | 'code' | 'download' | 'more'

/** the items, dividers written as '|', at each tier: everything inline, the three rarest folded, five folded */
export const TIERS: readonly (readonly (ToolId | '|')[])[] = [
  ['undo', 'redo', '|', 'zoomOut', 'zoom', 'zoomIn', '|', 'desktop', 'tablet', 'mobile', '|', 'outlines', 'preview', 'fullscreen', 'code', 'download'],
  ['undo', 'redo', '|', 'zoomOut', 'zoom', 'zoomIn', '|', 'desktop', 'tablet', 'mobile', '|', 'outlines', 'preview', 'more'],
  ['undo', 'redo', '|', 'zoomOut', 'zoom', 'zoomIn', '|', 'desktop', 'tablet', 'mobile', '|', 'more'],
] as const

/** what sits in the More menu at each tier, in menu order */
export const FOLDED: readonly (readonly ToolId[])[] = [[], ['fullscreen', 'code', 'download'], ['outlines', 'preview', 'fullscreen', 'code', 'download']]

/**
 * The narrowest tier buys its last few pixels two ways: the dividers sit 4px from their neighbours rather than
 * 8px, and the zoom button drops "Fit · " for the bare percentage. Both only here — anywhere wider is roomy.
 */
export const COMPACT_TIER = 2
export const GAP = 8
export const COMPACT_DIVIDER_GAP = 4
/** the row's own padding, per side, at each tier */
export const ROW_PADDING: readonly number[] = [12, 12, 8]

/** The first tier whose measured group fits the room the row has; the smallest tier when none does. */
export function chooseTier(rowWidth: number, tierWidths: readonly number[]): number {
  if (rowWidth <= 0) return 0 // nothing laid out yet: fold nothing rather than fold by mistake
  for (let tier = 0; tier < TIERS.length; tier++) {
    if ((tierWidths[tier] ?? 0) <= rowWidth - ROW_PADDING[tier] * 2) return tier
  }
  return TIERS.length - 1
}
