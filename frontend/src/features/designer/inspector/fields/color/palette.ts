/**
 * The swatches the colour picker offers.
 *
 * This is the one file in the inspector allowed literal hex: these are colours that go into the email, where
 * there are no custom properties and no stylesheet of ours. The app's own UI chrome reads tokens, never these.
 */
import { BRAND } from '../../../blocks/brand'

export interface Swatch {
  hex: string
  /** read out by a screen reader and shown on hover, so it has to say which colour this is */
  name: string
}

/** The template's own colours, so a block can be matched to the design without hunting for the value. */
export const BRAND_SWATCHES: Swatch[] = [
  { hex: BRAND.action, name: 'Brand blue' },
  { hex: BRAND.heading, name: 'Heading navy' },
  { hex: BRAND.body, name: 'Body slate' },
  { hex: BRAND.muted, name: 'Muted slate' },
  { hex: BRAND.page, name: 'Page grey' },
  { hex: BRAND.line, name: 'Line grey' },
]

export const NEUTRAL_SWATCHES: Swatch[] = [
  { hex: '#ffffff', name: 'White' },
  { hex: '#f1f5f9', name: 'Grey 50' },
  { hex: '#e2e8f0', name: 'Grey 200' },
  { hex: '#cbd5e1', name: 'Grey 300' },
  { hex: '#94a3b8', name: 'Grey 400' },
  { hex: '#475569', name: 'Grey 600' },
  { hex: '#1e293b', name: 'Grey 800' },
  { hex: '#000000', name: 'Black' },
]

export const ACCENT_SWATCHES: Swatch[] = [
  { hex: '#dc2626', name: 'Red' },
  { hex: '#ea580c', name: 'Orange' },
  { hex: '#ca8a04', name: 'Amber' },
  { hex: '#16a34a', name: 'Green' },
  { hex: '#0891b2', name: 'Teal' },
  { hex: '#7c3aed', name: 'Violet' },
]

export const SWATCH_GROUPS: { id: string; label: string; swatches: Swatch[] }[] = [
  { id: 'brand', label: 'Template colours', swatches: BRAND_SWATCHES },
  { id: 'neutral', label: 'Greys', swatches: NEUTRAL_SWATCHES },
  { id: 'accent', label: 'Accents', swatches: ACCENT_SWATCHES },
]

const BY_HEX = new Map(
  [...BRAND_SWATCHES, ...NEUTRAL_SWATCHES, ...ACCENT_SWATCHES].map((swatch) => [swatch.hex.toLowerCase(), swatch.name]),
)

/** The swatch's name when we have one, otherwise the hex itself, which is still something to read aloud. */
export function nameForHex(hex: string): string {
  return BY_HEX.get(hex.toLowerCase()) ?? hex
}
