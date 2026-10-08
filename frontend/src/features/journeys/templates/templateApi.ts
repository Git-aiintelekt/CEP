/** Reads CEP's starters and the workspace's own saved templates (journey.edit on the server), and shows a saved template through
 * the starter's shape so the cards, the gallery, the preview and the Setup pre-fill treat both alike. */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { JourneyStarter, JourneyTemplate } from '@/lib/types'

export const STARTERS_KEY = ['journey-starters'] as const
export const SAVED_TEMPLATES_KEY = ['journey-templates'] as const

export function useStarters() {
  return useQuery({
    queryKey: STARTERS_KEY,
    queryFn: ({ signal }) => api.get<JourneyStarter[]>('/journey-starters/', undefined, signal),
    staleTime: Infinity,
  })
}

export function starterFromTemplate(template: JourneyTemplate): JourneyStarter {
  return {
    key: `template:${template.id}`,
    template_id: template.id,
    name: template.name,
    category: template.category,
    description: template.description ?? '',
    goal: template.goal_description ?? '',
    population_mode: template.population_mode,
    reentry_policy: template.reentry_policy,
    reentry_after_days: template.reentry_after_days,
    graph: template.graph,
    step_count: template.step_count,
    channels: template.channels,
    saved: { created_by_name: template.created_by_name, created_at: template.created_at, used_count: template.used_count, row_version: template.row_version },
  }
}

export function isSavedTemplate(starter: JourneyStarter): boolean {
  return Boolean(starter.template_id)
}

/** The workspace's saved templates as starters, newest first; not fetched without journey.edit. */
export function useSavedTemplates(enabled = true) {
  return useQuery({
    queryKey: SAVED_TEMPLATES_KEY,
    queryFn: ({ signal }) => api.get<JourneyTemplate[]>('/journey-templates/', undefined, signal),
    select: (rows) => rows.map(starterFromTemplate),
    enabled,
  })
}
