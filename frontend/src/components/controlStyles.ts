/** Text-control looks shared by TextInput, Select, InputGroup and the editor's own fields. */

/** md (40px, with the gap under its label) for page forms; sm (32px) for dense editor panels */
export type ControlSize = 'sm' | 'md'
/** sunken is the Gray 100 fill for search and header fields, borderless at rest; it turns white while focused */
export type ControlTone = 'default' | 'sunken'

export const CONTROL_BASE =
  'w-full border text-sm text-ink-900 transition-colors duration-base ease-standard focus-visible:border-brand-600 disabled:border-line disabled:bg-line-subtle disabled:text-ink-300'
// corners round with height: 32px → 6px, 40px → 8px
const SIZE: Record<ControlSize, string> = { sm: 'h-8 px-2 rounded-control-md', md: 'mt-1 h-10 px-3 rounded-control-lg' }
export const FILL: Record<ControlTone, string> = { default: 'bg-surface', sunken: 'bg-surface-sunken focus:bg-surface' }

export function borderClass(invalid: boolean, warning = false): string {
  return invalid ? 'border-danger' : warning ? 'border-warning' : 'border-line'
}

export function controlClass({ size = 'md', tone = 'default', invalid = false, warning = false }: { size?: ControlSize; tone?: ControlTone; invalid?: boolean; warning?: boolean } = {}): string {
  const border = tone === 'sunken' && !invalid && !warning ? 'border-transparent' : borderClass(invalid, warning)
  return `${CONTROL_BASE} ${SIZE[size]} ${FILL[tone]} ${border}`
}
