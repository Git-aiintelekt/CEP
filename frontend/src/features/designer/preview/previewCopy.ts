/** The Preview tab's words and widths, apart from the component so the tests and the component share one copy. */
import { DEVICES, frameWidthFor } from '../zoom/zoom'

export type PreviewDevice = 'desktop' | 'mobile'

/** The email's own widths, the same the canvas lays it out at: 600 on a desktop, 360 on a phone. */
export const PREVIEW_WIDTH: Record<PreviewDevice, number> = {
  desktop: DEVICES[0].content,
  mobile: DEVICES[DEVICES.length - 1].content,
}

/**
 * The frame each is drawn in, sized as the canvas sizes its own. On a desktop the email sits in a gutter, so a
 * scrollbar that takes up space (most Windows setups) narrows the gutter rather than the email. A phone's layout
 * is fluid, so no gutter helps there: its frame hides its scrollbar instead, as a phone's own does.
 */
export const PREVIEW_FRAME_WIDTH: Record<PreviewDevice, number> = {
  desktop: frameWidthFor(DEVICES[0]),
  mobile: frameWidthFor(DEVICES[DEVICES.length - 1]),
}

export const PREVIEW_FRAME_TITLE = 'Email preview'
export const PREVIEW_AS_LABEL = 'Preview as'
export const DEVICE_LABEL = 'Device'
export const LOADING_LABEL = 'Building the preview'
export const EMPTY_TITLE = 'There is nothing to preview yet.'
export const EMPTY_HINT = 'Add a block to see it here.'
export const FAILED_NOTE = 'This email can’t be previewed yet because one of its blocks has a problem.'
export const SHOW_DETAILS = 'Show details'
export const HIDE_DETAILS = 'Hide details'
export const EMPTY_LINK_NOTE = 'A link is empty for this contact.'
export const FOOTNOTE = 'This is a preview. The email that is sent is built by the server when you save.'
