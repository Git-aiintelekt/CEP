/** The status actions the list and the detail page share. The API decides what is allowed (campaign.actions); these only ask. */
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { BulkResult, Campaign } from '@/lib/types'

export type StatusAction = 'pause' | 'resume' | 'cancel-schedule' | 'clone' | 'archive' | 'unarchive' | 'stop'

const DONE: Record<StatusAction, (before: Campaign, after: Campaign) => string> = {
  pause: (c) => `“${c.name}” is paused. Nothing more goes out until it is resumed.`,
  resume: (c) => `“${c.name}” is running again.`,
  'cancel-schedule': (c) => `The scheduled send of “${c.name}” is cancelled. The campaign is a draft again.`,
  clone: (_, copy) => `“${copy.name}” was created as a draft.`,
  archive: (c) => `“${c.name}” is archived. It stays available for reporting.`,
  unarchive: (c, after) => `“${c.name}” is back as ${after.display_status_label}.`,
  stop: (c, after) => `The remaining messages of “${c.name}” are cancelled${after.stopped_early?.cancelled ? ` (${after.stopped_early.cancelled})` : ''}. Messages already sent stay in reports.`,
}

/** what the confirm dialog asks before an action that stops or hides something; the others run at once */
export const CONFIRM: Partial<Record<StatusAction, { title: string; text: (campaign: Campaign) => string; button: string }>> = {
  pause: { title: 'Pause this campaign?', button: 'Pause', text: (c) => `Sending of “${c.name}” stops. Messages already handed to the provider still go out. You can resume it later.` },
  'cancel-schedule': { title: 'Cancel the scheduled send?', button: 'Cancel the Send', text: (c) => `“${c.name}” goes back to a draft, and can be edited and published again.` },
  archive: { title: 'Archive this campaign?', button: 'Archive', text: (c) => `“${c.name}” leaves the everyday list. Nothing is deleted: its results stay available, and it can be restored.` },
}

export function useCampaignAction(onDone?: (message: string, after: Campaign, action: StatusAction) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ campaign, action }: { campaign: Campaign; action: StatusAction }) => api.post<Campaign>(`/campaigns/${campaign.id}/${action}/`),
    onSuccess: async (after, { campaign, action }) => {
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      onDone?.(DONE[action](campaign, after), after, action)
    },
  })
}

export type BulkAction = 'archive' | 'clone' | 'pause' | 'resume'
export const BULK_DONE: Record<BulkAction, string> = { archive: 'archived', clone: 'cloned', pause: 'paused', resume: 'resumed' }

export function useBulkAction(onDone?: (result: BulkResult) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { action: BulkAction; ids: string[] }) => api.post<BulkResult>('/campaigns/bulk/', body),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      onDone?.(result)
    },
  })
}
