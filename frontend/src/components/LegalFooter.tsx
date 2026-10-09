/** The legal line every page ends with: the copyright, with the current year and the holder the platform names
 * (GET /legal/, the Legal global parameters), and the link to the Terms of Use. */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { api } from '@/lib/api'
import type { Legal } from '@/lib/types'

export const LEGAL_KEY = ['legal'] as const
const FALLBACK_HOLDER = 'Transaction Tree'

export function useLegal() {
  return useQuery({ queryKey: LEGAL_KEY, queryFn: ({ signal }) => api.get<Legal>('/legal/', undefined, signal), staleTime: Infinity, retry: 1 })
}

export function copyrightLine(holder: string | undefined, year = new Date().getFullYear()): string {
  return `© ${year} ${holder || FALLBACK_HOLDER}`
}

/** `bar`: the app shell's foot of the page, a hairline above. `inline`: a line on its own, for the sign-in frame and the terms page. */
export function LegalFooter({ variant = 'inline', className = '' }: { variant?: 'bar' | 'inline'; className?: string }) {
  const legal = useLegal()
  const line = copyrightLine(legal.data?.copyright_holder)
  const inner = (
    <>
      <span>{line}</span>
      <Link to="/terms" className="hover:text-ink-900 hover:underline">Terms of Use</Link>
    </>
  )
  if (variant === 'bar') {
    return (
      <footer aria-label="Legal" className={`mt-10 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-4 text-helper-sm text-ink-800 ${className}`}>{inner}</footer>
    )
  }
  return <footer aria-label="Legal" className={`flex flex-wrap gap-4 text-helper text-ink-800 ${className}`}>{inner}</footer>
}
