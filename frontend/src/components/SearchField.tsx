import { Search } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'

import { InputGroup } from './InputGroup'

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type' | 'onChange' | 'value'> {
  /** the field's accessible name */
  label: string
  value: string
  onChange: (value: string) => void
  /** the full width of its container, as inside a pop-up */
  wide?: boolean
}

/**
 * A list page's search: the sunken 40px pill with the magnifier, 240px from sm (full width on phones), first on the filter
 * line with the FilterChips after it (Insights → Reports set the pattern).
 */
export function SearchField({ label, value, onChange, placeholder, wide = false, className = '', ...props }: SearchFieldProps) {
  return (
    <div className={`w-full ${wide ? '' : 'sm:w-60'} ${className}`}>
      <InputGroup {...props} tone="sunken" controlSize="md" type="search" aria-label={label} placeholder={placeholder ?? label} value={value}
        onChange={(event) => onChange(event.target.value)} start={<Search size={16} strokeWidth={1.5} aria-hidden />} />
    </div>
  )
}
