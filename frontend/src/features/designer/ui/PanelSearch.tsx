/** The design's pop-up search field, reused by the Blocks and Tags panels. */
import { Search, X } from 'lucide-react'
import { useId } from 'react'

export function PanelSearch({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <div className="shrink-0 p-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex h-8 items-center gap-1.5 rounded-sm border border-transparent bg-surface-sunken pr-1 pl-2 focus-within:border-brand-600 focus-within:bg-surface focus-within:shadow-focus">
        <Search size={15} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-800" />
        <input
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="cep-input-bare h-[26px] w-full min-w-0 border-none bg-transparent text-[13px] text-ink-900 outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {value !== '' && (
          <button
            type="button"
            aria-label="Clear Search"
            onClick={() => onChange('')}
            className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm text-ink-800 hover:bg-fill-muted"
          >
            <X size={13} strokeWidth={1.5} aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}
