/** What a message's template copy holds, read through the Templates library's shared preview (cached per template). */
import { resolvedText, usePreviewContent } from '@/apps/cep/features/templates/preview/usePreviewContent'
import type { DripStep, Template } from '@/lib/types'

/** what a step's template copy is, for the shared template preview (it reads the id and the channel) */
export const templateItem = (template: NonNullable<DripStep['template']>) => ({ kind: 'template' as const, template: { ...template, description: null, cloned_from: null } as unknown as Template })

/** the first line of a text message's template copy */
export function useMessageText(step: DripStep, enabled: boolean): { text: string; image: string | null; loading: boolean } {
  const item = templateItem(step.template ?? { id: '', name: '', channel: 'SMS', status: '' })
  const preview = usePreviewContent(item, { enabled: enabled && Boolean(step.template) })
  const data = preview.data?.kind === 'message' ? preview.data : null
  return { text: data ? resolvedText(data.body, preview.tags).trim() : '', image: data?.media?.url ?? null, loading: preview.isPending && enabled && Boolean(step.template) }
}
