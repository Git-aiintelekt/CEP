/**
 * The literal values the blocks put into MJML. Email clients have no CSS variables and no stylesheet of ours,
 * so every colour has to be written into the markup — these are kept here rather than spread across the set.
 * They match the starter template (./starter.ts); the app's own UI tokens live in src/index.css.
 */
export const BRAND = {
  action: '#2753e4',
  heading: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  page: '#f6f7fb',
  surface: '#ffffff',
  line: '#e7e8ef',
} as const

/**
 * The receipt's brand bar colours, from the design system's navy, teal and gray. Navy 900 and Gray 900 are its
 * own values; the system has no Navy 700 or Teal 600, so those are its wordmark navy and wordmark teal.
 */
export const RECEIPT_SWATCHES = [
  { value: '#273fa8', label: 'Navy 700' },
  { value: '#20265d', label: 'Navy 900' },
  { value: '#418eae', label: 'Teal 600' },
  { value: '#17181c', label: 'Gray 900' },
] as const

/** The brand tag pair (Brand 100 / Brand 800), for a receipt's accent card. */
export const BRAND_TINT = { background: '#dee9fc', text: '#2b4dd0' } as const

export const FONT_STACK = 'Helvetica, Arial, sans-serif'

/**
 * What a block inside a column is inset by.
 *
 * MJML pads mj-text, mj-button and the rest with 10px 25px unless the block says otherwise — so a block that
 * sets its own padding to tidy its top and bottom silently gives up the 25px sides as well, and then sits
 * left of everything around it. In a section with no side padding of its own it ends up flush against the
 * edge of the email. The blocks that set padding restate the 25px, so every column-level block lines up.
 */
export const COLUMN_PADDING = '12px 25px'
export const BUTTON_RADIUS = '8px'

/**
 * Where a block needs a picture. The editor swaps it for a real image from the workspace library before the
 * block is ever offered, and a block carrying it is refused while the library is empty — so it never reaches
 * the canvas or a saved design.
 */
export const ASSET_IMAGE_TOKEN = '__ASSET_IMAGE__'
