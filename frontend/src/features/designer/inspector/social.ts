/**
 * MJML's built-in social networks. A plain name ("facebook") makes the icon a SHARE link — MJML wraps the href in the
 * network's sharer URL — while "facebook-noshare" links straight to the href. A social block in an email points at the
 * brand's own profiles, so the designer writes the direct form and reads either.
 */
import type { SelectOption } from './fields/options'

export const NOSHARE = '-noshare'

/** MJML has a sharer URL for these; the rest link directly whichever form is written. */
const SHARES = new Set(['facebook', 'twitter', 'x', 'google', 'pinterest', 'linkedin', 'tumblr', 'xing'])

export const SOCIAL_NETWORKS: SelectOption[] = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
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

/** A new icon for a social block: no address yet, so the Links pill asks for one. */
export function socialElementMjml(network: string): string {
  return `<mj-social-element name="${directName(network)}" href=""></mj-social-element>`
}
