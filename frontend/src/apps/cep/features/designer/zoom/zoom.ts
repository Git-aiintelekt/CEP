/**
 * Zoom arithmetic for the canvas. Pure: what the buttons, the menu and the wheel do to a percentage, and how
 * the canvas is panned so a zoomed-out email sits centred. No GrapesJS here.
 */

/** The steps the menu offers and the buttons walk. */
export const ZOOM_STEPS = [50, 75, 100, 125, 150] as const
export const ZOOM_MIN = 25
export const ZOOM_MAX = 200
export const FIT_GUTTER = 24

/** The width at which MJML stacks columns: its media query matches at this width and below. */
export const MJML_STACK_WIDTH = 480

/**
 * The devices the toolbar offers, in its order, with the width the email itself measures on each.
 *
 * Desktop carries a gutter because MJML caps the email at 600px: a wider frame leaves air around it rather
 * than stretching it. Below 600 the email fills whatever frame it is given, so a gutter there would only make
 * it narrower — Tablet and Mobile take their frame as their content. Tablet sits one pixel above the stacking
 * width so its columns stay side by side; Mobile sits below it, where they stack as they would on a phone.
 */
export const DEVICES = [
  { id: 'Desktop', label: 'Desktop', content: 600, gutter: FIT_GUTTER },
  { id: 'Tablet', label: 'Tablet', content: MJML_STACK_WIDTH + 1, gutter: 0 },
  { id: 'Mobile portrait', label: 'Mobile', content: 360, gutter: 0 },
] as const

/** The frame a device is given: its content plus whatever gutter that device carries. */
export function frameWidthFor(device: { content: number; gutter: number }): number {
  return device.content + device.gutter * 2
}

/** The Desktop frame: the 600px email plus a 24px gutter each side. */
export const DESKTOP_FRAME_WIDTH = frameWidthFor(DEVICES[0])

export type ZoomMode = 'fit' | 'manual'
export type ZoomDirection = 'in' | 'out'

/** every stop a button can land on, ends included */
const LADDER: readonly number[] = [ZOOM_MIN, ...ZOOM_STEPS, ZOOM_MAX]

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value)))
}

/** The next stop on the ladder; from between two stops (a fit value) the nearest one in that direction. */
export function nextZoom(current: number, direction: ZoomDirection): number {
  const from = clampZoom(current)
  if (direction === 'in') return LADDER.find((step) => step > from) ?? ZOOM_MAX
  return [...LADDER].reverse().find((step) => step < from) ?? ZOOM_MIN
}

/** The largest whole percentage at which the frame fits the canvas with a gutter each side, never above 100. */
export function fitZoom(canvasWidth: number, frameWidth = DESKTOP_FRAME_WIDTH, gutter = FIT_GUTTER): number {
  const available = canvasWidth - gutter * 2
  if (!(available > 0) || !(frameWidth > 0)) return ZOOM_MIN
  return clampZoom(Math.min(100, Math.floor((available / frameWidth) * 100)))
}

/**
 * How far the frame is panned once scaled. GrapesJS lays the frame out for 100% — centred, or pinned to the
 * left edge when it is wider than the canvas — and scales about the canvas centre. A frame that fits after
 * scaling is put back in the middle; one that does not is pinned to the left edge, so the canvas can scroll
 * to the rest instead of clipping the start of the email behind its left edge.
 */
export function panForZoom(frameWidth: number, canvasWidth: number, zoom: number): number {
  const scale = zoom / 100
  const centre = canvasWidth / 2
  const leftAtFull = Math.max(0, (canvasWidth - frameWidth) / 2)
  const leftNow = centre - (centre - leftAtFull) * scale
  const shown = frameWidth * scale
  const wanted = shown <= canvasWidth ? (canvasWidth - shown) / 2 : 0
  return wanted - leftNow
}

/** `compact` drops the "Fit · " where there is no room for it; the menu's tick still says which mode is on. */
export function formatZoom(zoom: number, mode: ZoomMode, compact = false): string {
  return mode === 'fit' && !compact ? `Fit · ${zoom}%` : `${zoom}%`
}

/** A wheel gesture arrives as a stream of events; one step per this many milliseconds keeps it to a step or two. */
export const WHEEL_STEP_GAP_MS = 200

/** `lastStepAt` is -Infinity before the first step, so the first tick of a gesture always lands. */
export function wheelStepDue(lastStepAt: number, now: number): boolean {
  return now - lastStepAt >= WHEEL_STEP_GAP_MS
}

/** Ctrl or Cmd with the wheel zooms; anything else is left to scroll. */
export function wheelZoomDirection(event: { ctrlKey: boolean; metaKey: boolean; deltaY: number }): ZoomDirection | null {
  if (!event.ctrlKey && !event.metaKey) return null
  if (event.deltaY === 0) return null
  return event.deltaY < 0 ? 'in' : 'out'
}
