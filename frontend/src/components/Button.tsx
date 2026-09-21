import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, MouseEvent, Ref } from 'react'

import { buttonClass, iconButtonClass, type ButtonSize, type ButtonVariant, type IconButtonSize, type IconButtonVariant } from './buttonStyles'
import { Spinner } from './States'

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> {
  ref?: Ref<HTMLButtonElement>
  variant?: ButtonVariant
  size?: ButtonSize
  iconStart?: LucideIcon
  iconEnd?: LucideIcon
  /** shows a spinner in place of the start icon and blocks clicks; the label stays so the width does not jump */
  loading?: boolean
  /** native disabled: out of the tab order */
  disabled?: boolean
  /** looks disabled but stays focusable, so a title or aria-describedby can say why */
  softDisabled?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  iconStart: IconStart,
  iconEnd: IconEnd,
  loading = false,
  disabled = false,
  softDisabled = false,
  type = 'button',
  className = '',
  onClick,
  children,
  ...props
}: ButtonProps) {
  const blocked = loading || softDisabled
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (blocked) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  return (
    <button
      {...props}
      type={type}
      disabled={disabled}
      aria-disabled={blocked || undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
      className={`${buttonClass({ variant, size, disabled: softDisabled })} ${className}`}
    >
      {loading ?
        <Spinner size="sm" tone={variant === 'primary' ? 'onBrand' : 'default'} />
      : IconStart && <IconStart size={16} strokeWidth={1.5} aria-hidden />}
      {children}
      {IconEnd && <IconEnd size={16} strokeWidth={1.5} aria-hidden />}
    </button>
  )
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'children'> {
  ref?: Ref<HTMLButtonElement>
  /** the accessible name, also shown as the hover hint; icon-only buttons are never unlabelled */
  label: string
  icon: LucideIcon
  variant?: IconButtonVariant
  size?: IconButtonSize
  /** a toggle's on state; sets aria-pressed */
  pressed?: boolean
  disabled?: boolean
  softDisabled?: boolean
}

export function IconButton({
  label,
  icon: Icon,
  variant = 'ghost',
  size = 'sm',
  pressed,
  disabled = false,
  softDisabled = false,
  type = 'button',
  className = '',
  title,
  onClick,
  ...props
}: IconButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (softDisabled) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      disabled={disabled}
      aria-disabled={softDisabled || undefined}
      onClick={handleClick}
      className={`${iconButtonClass({ variant, size, pressed: Boolean(pressed), disabled: disabled || softDisabled })} ${className}`}
    >
      <Icon size={size === 'xs' ? 14 : 16} strokeWidth={1.5} aria-hidden />
    </button>
  )
}
