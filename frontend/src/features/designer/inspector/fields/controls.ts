/** The 32px control look, shared so every field lines up. Form.tsx's own is 40px and carries its own margin. */
const CONTROL_SHAPE = 'h-8 w-full rounded-sm border px-2 text-sm transition-colors duration-base ease-standard focus-visible:border-brand-600'

const CONTROL_32 = `${CONTROL_SHAPE} bg-surface text-ink-900`

/**
 * Enabled and disabled colours are never both on one element: which of two background or text utilities wins is
 * down to the stylesheet's order, not the class list's, and the white one did — so a disabled field read as live.
 */
export function controlClass(invalid: boolean, disabled: boolean): string {
  // grey fill, never faded; the value stays at a readable grey because view-only mode is for reading it
  if (disabled) return `${CONTROL_SHAPE} border-line bg-fill-subtle text-ink-800`
  return `${CONTROL_32} ${invalid ? 'border-danger' : 'border-line-control'}`
}
