/** A shared formula's mark in a field list: a tick for a certified one, else the word Shared. */
import { BadgeCheck } from 'lucide-react'

import type { CatalogField } from '../types'

export function SharedFieldMark({ field }: { field: CatalogField }) {
  if (!field.shared) return null
  const about = field.shared.description ? `: ${field.shared.description}` : ''
  if (field.shared.certified) {
    return (
      <span title={`Certified${field.shared.certified_by_name ? ` by ${field.shared.certified_by_name}` : ''}${about}`} className="inline-flex shrink-0 items-center">
        <BadgeCheck size={14} strokeWidth={1.5} aria-label="Certified" className="text-success-text" />
      </span>
    )
  }
  return <span title={`A shared formula${about}`} className="shrink-0 text-[10px] font-semibold text-ink-700 uppercase">Shared</span>
}
