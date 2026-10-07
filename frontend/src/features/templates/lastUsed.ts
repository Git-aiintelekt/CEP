/** "Used in Fall Launch (Active)", "Loyalty Welcome Series · Message 2 of 4" or "Not used by a campaign yet": what is safe to change about a template. */
import { titleize } from '@/lib/format'
import type { Template } from '@/lib/types'

export function lastUsedText(template: Pick<Template, 'last_used_in' | 'campaign_count' | 'used_in_drip'>): string {
  const drip = template.used_in_drip
  if (drip) return `${drip.campaign_name} · Message ${drip.position} of ${drip.count}`
  const used = template.last_used_in
  if (!used) return 'Not used by a campaign yet'
  const more = (template.campaign_count ?? 1) - 1
  return `Used in ${used.name} (${titleize(used.status)})${more > 0 ? ` and ${more} more` : ''}`
}

export const isUsed = (template: Pick<Template, 'last_used_in' | 'used_in_drip'>) => Boolean(template.last_used_in || template.used_in_drip)

/** a live drip's message: nothing about the template may change (the API refuses with this same sentence, 409) */
export function dripLockNote(template: Pick<Template, 'used_in_drip'>): string | null {
  const drip = template.used_in_drip
  if (!drip?.locked) return null
  return `Used by a live drip (${drip.campaign_name}, message ${drip.position}). It can't be changed until the drip finishes or is stopped.`
}

/** the API's refusal of a save on a locked template, as against someone else's newer version */
export const isDripLockRefusal = (message: string) => message.startsWith('Used by a live drip')

/** a drip's message templates together, in name order (where the first of them falls on the page); the rest keep the server's order */
export function groupDripTemplates(rows: Template[]): Template[] {
  const placed = new Set<string>()
  return rows.flatMap((template) => {
    const drip = template.used_in_drip?.campaign_id
    if (!drip) return [template]
    if (placed.has(drip)) return []
    placed.add(drip)
    return rows.filter((row) => row.used_in_drip?.campaign_id === drip).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  })
}
