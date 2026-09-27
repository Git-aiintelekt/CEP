/** "Used in Fall Launch (Active)" or "Not used by a campaign yet": what is safe to change about a template. */
import { titleize } from '@/lib/format'
import type { Template } from '@/lib/types'

export function lastUsedText(template: Template): string {
  const used = template.last_used_in
  if (!used) return 'Not used by a campaign yet'
  const more = (template.campaign_count ?? 1) - 1
  return `Used in ${used.name} (${titleize(used.status)})${more > 0 ? ` and ${more} more` : ''}`
}
