import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

interface TileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  ref?: Ref<HTMLButtonElement>
  label: string
  /** a block type: icon centred above the label */
  icon?: LucideIcon
  /** an asset: thumbnail above a left-aligned caption */
  thumbnail?: ReactNode
  /** the tile can be carried onto the canvas */
  grab?: boolean
  /** soft disabled: aria-disabled, stays focusable so its title can say why */
  softDisabled?: boolean
}

/**
 * A draggable, clickable card in the blocks and assets panels. Flat: a hairline that darkens on hover, never a
 * shadow. Drag handlers and draggable pass straight through.
 */
export function Tile({ label, icon: Icon, thumbnail, grab = false, softDisabled = false, type = 'button', className = '', onClick, ...props }: TileProps) {
  const state =
    softDisabled ? 'cursor-not-allowed border-line bg-fill-subtle text-ink-300'
    : `border-line bg-surface text-ink-800 hover:border-ink-300 hover:bg-surface-subtle focus:border-brand-600 ${grab ? 'cursor-grab' : ''}`
  const layout = thumbnail ? 'gap-1 p-1 text-left' : 'items-center gap-1 px-[2px] py-2.5 text-center'

  return (
    <button
      {...props}
      type={type}
      aria-disabled={softDisabled || undefined}
      onClick={softDisabled ? undefined : onClick}
      className={`flex w-full flex-col rounded-sm border ${layout} ${state} ${className}`}
    >
      {thumbnail ?
        <span className="flex h-10 w-full items-center justify-center overflow-hidden rounded-xs bg-fill-subtle">{thumbnail}</span>
      : Icon && <Icon size={18} strokeWidth={1.5} aria-hidden />}
      <span className={`w-full text-[10px] leading-[1.2] ${thumbnail ? 'truncate' : 'font-medium'}`}>{label}</span>
    </button>
  )
}
