/** The fixed choices the align and select fields offer. */
import {
  AlignCenter, AlignLeft, AlignRight, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  type LucideIcon,
} from 'lucide-react'

export type AlignAxis = 'horizontal' | 'vertical'

export interface AlignOption {
  value: string
  label: string
  icon: LucideIcon
}

export interface SelectOption {
  value: string
  label: string
}

export const ALIGN_OPTIONS: Record<AlignAxis, AlignOption[]> = {
  horizontal: [
    { value: 'left', label: 'Left', icon: AlignLeft },
    { value: 'center', label: 'Center', icon: AlignCenter },
    { value: 'right', label: 'Right', icon: AlignRight },
  ],
  vertical: [
    { value: 'top', label: 'Top', icon: AlignVerticalJustifyStart },
    { value: 'middle', label: 'Middle', icon: AlignVerticalJustifyCenter },
    { value: 'bottom', label: 'Bottom', icon: AlignVerticalJustifyEnd },
  ],
}

/**
 * Email-safe families, each with the fallbacks a mail client is expected to have. Web fonts are not offered: they
 * need an mj-font in the head and most inboxes ignore them anyway. Ubuntu is here because it is MJML's own default,
 * so the "Default (…)" row can name it.
 */
export const FONT_FAMILIES: SelectOption[] = [
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: 'Tahoma, Geneva, sans-serif', label: 'Tahoma' },
  { value: "'Trebuchet MS', Helvetica, sans-serif", label: 'Trebuchet MS' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
  { value: "'Courier New', Courier, monospace", label: 'Courier New' },
  { value: 'Ubuntu, Helvetica, Arial, sans-serif', label: 'Ubuntu' },
]

/** How a social block lays its icons out. */
export const SOCIAL_MODES: SelectOption[] = [
  { value: 'horizontal', label: 'In a Row' },
  { value: 'vertical', label: 'Stacked' },
]

/** MJML takes the CSS keywords or the numbers; the numbers travel better, so those are what we write. */
export const FONT_WEIGHTS: SelectOption[] = [
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semibold' },
  { value: '700', label: 'Bold' },
]

/** MJML's border shorthand takes any CSS style; these are the ones email clients draw alike. */
export const BORDER_STYLES: SelectOption[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'double', label: 'Double' },
]

export const SHADOW_OPTIONS: SelectOption[] = [
  { value: 'soft', label: 'Soft' },
  { value: 'medium', label: 'Medium' },
  { value: 'strong', label: 'Strong' },
]
