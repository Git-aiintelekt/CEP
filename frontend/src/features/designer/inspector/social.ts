/**
 * MJML's built-in social networks. A plain name ("facebook") makes the icon a SHARE link — MJML wraps the href in the
 * network's sharer URL — while "facebook-noshare" links straight to the href. A social block in an email points at the
 * brand's own profiles, so the designer writes the direct form and reads either.
 */
import { absoluteUrl } from '../assets/assetAction'
import type { SelectOption } from './fields/options'

export const NOSHARE = '-noshare'

/**
 * Networks MJML has no icon for. The designer serves the icon itself (frontend/public) and writes it on the element,
 * with the network's colour behind it: MJML's icons are white glyphs on a transparent PNG, and so are these.
 */
export const OWN_ICONS: Record<string, { src: string; background: string }> = {
  tiktok: { src: '/social-icons/tiktok.png', background: '#000000' },
}

/** MJML has a sharer URL for these; the rest link directly whichever form is written. */
const SHARES = new Set(['facebook', 'twitter', 'x', 'google', 'pinterest', 'linkedin', 'tumblr', 'xing'])

export const SOCIAL_NETWORKS: SelectOption[] = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'x', label: 'X' },
  { value: 'twitter', label: 'Twitter' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'pinterest', label: 'Pinterest' },
  { value: 'snapchat', label: 'Snapchat' },
  { value: 'tumblr', label: 'Tumblr' },
  { value: 'github', label: 'GitHub' },
  { value: 'vimeo', label: 'Vimeo' },
  { value: 'medium', label: 'Medium' },
  { value: 'soundcloud', label: 'SoundCloud' },
  { value: 'dribbble', label: 'Dribbble' },
  { value: 'xing', label: 'Xing' },
  { value: 'google', label: 'Google' },
  { value: 'web', label: 'Website' },
]

/** "facebook-noshare" -> "facebook": the network, whichever form the design carries. */
export function networkOf(name: string | null | undefined): string | null {
  const trimmed = String(name ?? '').trim().toLowerCase()
  if (trimmed === '') return null
  return trimmed.endsWith(NOSHARE) ? trimmed.slice(0, -NOSHARE.length) : trimmed
}

/** The name to write so the icon links to the href itself rather than to a sharer page. */
export function directName(network: string): string {
  const plain = networkOf(network) ?? network
  return SHARES.has(plain) ? `${plain}${NOSHARE}` : plain
}

/** "youtube" -> "YouTube"; a network MJML knows and we do not still reads as a word. */
export function networkLabel(name: string | null | undefined): string | null {
  const network = networkOf(name)
  if (network === null) return null
  return SOCIAL_NETWORKS.find((option) => option.value === network)?.label ?? network.charAt(0).toUpperCase() + network.slice(1)
}

/**
 * The attributes an icon of our own needs on its element; nothing for a network MJML draws itself. The square behind
 * the icon takes the colour its neighbours share (a brand keeps its icons one colour), else the network's own.
 */
export function ownIconAttributes(network: string | null | undefined, sharedBackground: string | null = null): { src: string; 'background-color': string } | null {
  const own = OWN_ICONS[networkOf(network) ?? '']
  return own ? { src: absoluteUrl(own.src), 'background-color': sharedBackground ?? own.background } : null
}

/** The one background colour a block's icons all set themselves, or null when they differ or leave it to MJML. */
export function sharedBackgroundOf(siblings: { getAttributes: () => Record<string, unknown> }[]): string | null {
  const colours = siblings.map((icon) => String(icon.getAttributes()['background-color'] ?? '').trim().toLowerCase()).filter(Boolean)
  return colours.length > 0 && colours.length === siblings.length && new Set(colours).size === 1 ? colours[0] : null
}

/** A new icon for a social block: no address yet, so the Links pill asks for one. */
export function socialElementMjml(network: string, sharedBackground: string | null = null): string {
  const own = ownIconAttributes(network, sharedBackground)
  const extra = own ? ` src="${own.src}" background-color="${own['background-color']}"` : ''
  return `<mj-social-element name="${directName(network)}" href=""${extra}></mj-social-element>`
}
