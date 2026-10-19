/**
 * A dashboard's theme: the order of the chart colours its tiles use, from the design tokens only (no colour of its own). The
 * theme sets the chart variables on the dashboard's box, so every chart inside reads them; each value names a token that is not
 * a chart variable itself, so nothing refers back to what it replaces.
 */
import type { CSSProperties } from 'react'

import type { DashboardTheme } from '../types'

const v = (token: string) => `var(--color-${token})`

const PALETTES: Record<Exclude<DashboardTheme, 'default'>, string[]> = {
  navy: ['wordmark-navy', 'wordmark-teal', 'brand-600', 'plum-200', 'ink-700', 'channel-mms-icon'],
  earth: ['channel-receipt-icon', 'cat-seasonal-text', 'cat-promotional-text', 'channel-sms-icon', 'cat-transactional-text', 'cat-journey-text'],
  berry: ['cat-loyalty-text', 'cat-journey-text', 'channel-mms-icon', 'brand-700', 'cat-campaign-text', 'ink-300'],
  greyscale: ['ink-900', 'ink-700', 'ink-300', 'ink-800', 'cat-transactional-text', 'plum-200'],
}

export const THEMES: { value: DashboardTheme; label: string }[] = [
  { value: 'default', label: 'Classic' }, { value: 'navy', label: 'Navy' }, { value: 'earth', label: 'Earth' }, { value: 'berry', label: 'Berry' }, { value: 'greyscale', label: 'Greyscale' },
]

/** the style that puts the theme's colours on the dashboard's box; nothing for the classic look */
export function themeStyle(theme: DashboardTheme | undefined): CSSProperties | undefined {
  if (!theme || theme === 'default') return undefined
  const palette = PALETTES[theme]
  return Object.fromEntries([...palette.map((token, i) => [`--color-chart-${i + 1}`, v(token)]), ['--color-chart-pair', v(palette[1])]]) as CSSProperties
}
