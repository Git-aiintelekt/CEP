/** A bordered choice card with a styled native radio: Test Population's two modes and Approve's Now / Later. */
import type { ReactNode } from 'react'

interface RadioCardProps {
  name: string
  checked: boolean
  onSelect: () => void
  title: string
  description: string
  /** right of the title, e.g. the sample-size field */
  aside?: ReactNode
  /** under the description while the card is chosen */
  children?: ReactNode
}

const RADIO =
  'mt-0.5 h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-full border border-line-control bg-surface transition-colors duration-base ease-standard checked:border-brand-600 checked:bg-brand-600 checked:shadow-[inset_0_0_0_3px_var(--color-surface)]'

export function RadioCard({ name, checked, onSelect, title, description, aside, children }: RadioCardProps) {
  // the fields in `aside` and `children` sit outside the <label>, so they don't become part of the radio's name
  return (
    <div className={`rounded-lg border p-4 transition-colors duration-base ease-standard ${checked ? 'border-brand-600 bg-callout-bg' : 'border-line bg-surface hover:bg-surface-subtle'}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
          <input type="radio" name={name} className={RADIO} checked={checked} onChange={onSelect} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink-900">{title}</span>
            <span className="mt-0.5 block text-helper text-ink-800">{description}</span>
          </span>
        </label>
        {aside && <div className="pl-7 sm:pl-0">{aside}</div>}
      </div>
      {checked && children && <div className="pl-7">{children}</div>}
    </div>
  )
}
