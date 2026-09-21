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

/** MJML takes the CSS keywords or the numbers; the numbers travel better, so those are what we write. */
export const FONT_WEIGHTS: SelectOption[] = [
  { value: '300', label: 'Light' },
  { value: '400', label: 'Regular' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semibold' },
  { value: '700', label: 'Bold' },
]
