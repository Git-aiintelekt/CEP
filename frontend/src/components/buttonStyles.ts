/**
 * Button looks, kept as class strings so links and legacy call sites can share them with <Button> and <IconButton>.
 * Hover and press are colour changes only (70ms); disabled is Gray 100 fill, Gray 400 text, Gray 150 border.
 * `disabled` here means the soft, still-focusable kind (aria-disabled); native :disabled is covered by the variants too.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'link' | 'danger'
export type ButtonSize = 'sm' | 'md'

const BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 text-sm font-semibold whitespace-nowrap transition-colors duration-fast ease-standard'

// corners round with height: 32px → 6px, 40px → 8px
const SIZE: Record<ButtonSize, string> = { sm: 'h-8 px-3 rounded-control-md', md: 'h-10 px-4 rounded-control-lg' }

const ENABLED: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-800 active:bg-brand-800',
  secondary: 'border border-line bg-surface text-ink-900 hover:bg-surface-subtle active:bg-line-subtle',
  ghost: 'text-ink-700 hover:bg-line-subtle hover:text-ink-900 active:bg-line',
  link: 'text-brand-800 hover:bg-line-subtle active:bg-line',
  danger: 'border border-danger bg-surface text-danger-text hover:bg-danger-bg active:bg-danger-bg',
}

const FILLED_DISABLED = 'cursor-not-allowed border-line bg-line-subtle text-ink-300'
const BARE_DISABLED = 'cursor-not-allowed text-ink-300'

const DISABLED: Record<ButtonVariant, string> = {
  primary: FILLED_DISABLED,
  secondary: FILLED_DISABLED,
  danger: FILLED_DISABLED,
  ghost: BARE_DISABLED,
  link: BARE_DISABLED,
}

const NATIVE_DISABLED: Record<ButtonVariant, string> = {
  primary: 'disabled:cursor-not-allowed disabled:bg-line-subtle disabled:text-ink-300',
  secondary: 'disabled:cursor-not-allowed disabled:border-line disabled:bg-line-subtle disabled:text-ink-300',
  danger: 'disabled:cursor-not-allowed disabled:border-line disabled:bg-line-subtle disabled:text-ink-300',
  ghost: 'disabled:cursor-not-allowed disabled:bg-transparent disabled:text-ink-300',
  link: 'disabled:cursor-not-allowed disabled:bg-transparent disabled:text-ink-300',
}

export function buttonClass({
  variant = 'secondary',
  size = 'md',
  disabled = false,
}: { variant?: ButtonVariant; size?: ButtonSize; disabled?: boolean } = {}): string {
  return `${BASE} ${SIZE[size]} ${disabled ? DISABLED[variant] : `${ENABLED[variant]} ${NATIVE_DISABLED[variant]}`}`
}

export type IconButtonVariant = 'ghost' | 'outline' | 'onBrand'
/** sm is the 32px control; xs (24px) is only for a button nested inside another control or a dense row */
export type IconButtonSize = 'sm' | 'xs'

const ICON_BASE = 'inline-flex shrink-0 items-center justify-center transition-colors duration-fast ease-standard'
const ICON_SIZE: Record<IconButtonSize, string> = { sm: 'h-8 w-8 rounded-control-md', xs: 'h-6 w-6 rounded-control-sm' }

const ICON_STATE: Record<IconButtonVariant, { enabled: string; pressed: string; disabled: string }> = {
  ghost: {
    enabled: 'text-ink-700 hover:bg-line-subtle hover:text-ink-900 active:bg-line',
    pressed: 'bg-brand-100 text-brand-800',
    disabled: 'cursor-not-allowed text-ink-300',
  },
  outline: {
    enabled: 'border border-line bg-surface text-ink-700 hover:bg-surface-subtle hover:text-ink-900 active:bg-line-subtle',
    pressed: 'border border-brand-600 bg-brand-100 text-brand-800',
    disabled: 'cursor-not-allowed border border-line bg-line-subtle text-ink-300',
  },
  onBrand: {
    enabled: 'text-white hover:bg-brand-800 active:bg-brand-800',
    pressed: 'bg-brand-800 text-white',
    disabled: 'cursor-not-allowed text-brand-100',
  },
}

export function iconButtonClass({
  variant = 'ghost',
  size = 'sm',
  pressed = false,
  disabled = false,
}: { variant?: IconButtonVariant; size?: IconButtonSize; pressed?: boolean; disabled?: boolean } = {}): string {
  const state = ICON_STATE[variant]
  return `${ICON_BASE} ${ICON_SIZE[size]} ${disabled ? state.disabled : pressed ? state.pressed : state.enabled}`
}
