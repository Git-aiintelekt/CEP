/** The toolbar's words, kept apart from the component so the tests and the component share one copy. */
import type { ToolId } from './overflow'

export const FIT_LABEL = 'Fit to width'
export const ZOOM_MENU_LABEL = 'Zoom'
export const OUTLINES_LABEL = 'Show block outlines'
export const MORE_LABEL = 'More tools'
export const EXIT_FULLSCREEN_LABEL = 'Exit fullscreen'
export const TOOL_LABELS: Record<Exclude<ToolId, 'zoom' | 'more'>, string> = {
  undo: 'Undo', redo: 'Redo', zoomOut: 'Zoom out', zoomIn: 'Zoom in', desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile',
  outlines: OUTLINES_LABEL, preview: 'Preview', fullscreen: 'Fullscreen', code: 'View code', download: 'Download HTML',
}
