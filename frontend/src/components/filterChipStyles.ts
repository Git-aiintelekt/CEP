const CHIP = 'inline-flex h-10 max-w-full items-center gap-2 rounded-control-lg border px-3 text-label font-medium whitespace-nowrap transition-colors duration-fast ease-standard'
const CHIP_STATE = {
  rest: 'border-line bg-surface text-ink-900 hover:bg-surface-hover',
  active: 'border-link bg-brand-100 text-brand-800',
}

/** a filter chip's look; active: a non-default value is picked (Blue 600 border, Blue 100 fill, Blue 800 text) */
export function filterChipClass(active: boolean): string {
  return `${CHIP} ${active ? CHIP_STATE.active : CHIP_STATE.rest}`
}
