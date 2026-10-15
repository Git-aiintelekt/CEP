/** The toolbar's words, kept apart from the component so the tests and the component share one copy. */
import type { ToolId } from './overflow'

export const FIT_LABEL = 'Fit to Width'
export const ZOOM_MENU_LABEL = 'Zoom'
export const OUTLINES_LABEL = 'Show Block Outlines'
export const MORE_LABEL = 'More Tools'
export const EXIT_FULLSCREEN_LABEL = 'Exit Fullscreen'
export const TOOL_LABELS: Record<Exclude<ToolId, 'zoom' | 'more'>, string> = {
  undo: 'Undo', redo: 'Redo', zoomOut: 'Zoom Out', zoomIn: 'Zoom In', desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile',
  outlines: OUTLINES_LABEL, preview: 'Preview', fullscreen: 'Fullscreen', code: 'View Code', download: 'Download HTML',
}
