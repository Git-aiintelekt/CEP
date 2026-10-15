/**
 * What a template or preset looks like to one recipient, for the read-only preview and the SMS/MMS thumbnails.
 * Tags take each tag's own sample value: the same 'sample' profile the designer's Preview tab reads.
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { DEFAULT_PROFILE, fillForPreview } from '@/apps/cep/features/designer/preview/previewProfiles'
import { api } from '@/lib/api'
import type { Design, Message, MessageFindings, Page, PersonalizationTag, Preset, ReceiptLayout, ReceiptSection, Template, TemplateStarter } from '@/lib/types'

export type PreviewItem = { kind: 'preset'; preset: Preset } | { kind: 'template'; template: Template }

export type PreviewContent =
  | { kind: 'email'; html: string; subject: string; preheader: string; receipt?: { preset: ReceiptLayout['layout_preset']; sections: ReceiptSection[] } }
  | { kind: 'message'; channel: string; body: string; subject: string; media: Message['media_asset']; findings: MessageFindings | null }

export const channelOf = (item: PreviewItem) => (item.kind === 'preset' ? item.preset.channel : item.template.channel)

const isMessageChannel = (channel: string) => channel === 'SMS' || channel === 'MMS'

/** A message's text with each tag's sample filled in, as plain text. The thumbnails and the preview both read this. */
export function resolvedText(text: string, tags: PersonalizationTag[]): string {
  return fillForPreview(text, tags, DEFAULT_PROFILE, { escape: false })
}

/** The designer compiles with mjml-browser (behind grapesjs-mjml); loaded only when an email is actually previewed. */
async function compile(mjml: string): Promise<string> {
  const { default: mjml2html } = await import('mjml-browser')
  return mjml2html(mjml, { validationLevel: 'soft' }).html
}

/** An e-receipt as the customer gets it: the outer design with the receipt, filled from the sample transaction. */
async function withReceipt(outerHtml: string, sections: ReceiptSection[]): Promise<string> {
  const [{ combineReceiptEmail }, { DEFAULT_SAMPLE_TRANSACTION }] = await Promise.all([import('@/apps/cep/features/receipt/receiptCombined'), import('@/apps/cep/features/receipt/sampleReceiptData')])
  return combineReceiptEmail(outerHtml, sections, DEFAULT_SAMPLE_TRANSACTION)
}

async function load(item: PreviewItem, queryClient: QueryClient, signal: AbortSignal): Promise<PreviewContent> {
  if (item.kind === 'preset') {
    const { preset } = item
    const content = preset.content
    if (content?.kind === 'design') return { kind: 'email', html: await compile(content.mjml), subject: content.subject_line, preheader: content.preheader }
    if (content?.kind === 'receipt') return { kind: 'email', html: await withReceipt(await compile(content.mjml), content.sections), subject: content.subject_line, preheader: content.preheader, receipt: { preset: content.layout_preset, sections: content.sections } }
    if (content?.kind === 'message') return { kind: 'message', channel: preset.channel, body: content.sms_body, subject: content.subject_line, media: null, findings: null }

    // a server-only starter: the gallery's list is usually cached already
    const starters = await queryClient.fetchQuery({
      queryKey: ['template-starters', preset.channel],
      queryFn: () => api.get<TemplateStarter[]>('/template-starters/', { channel: preset.channel }, signal),
      staleTime: 10 * 60_000,
    })
    const starter = starters.find((candidate) => candidate.key === preset.key)
    if (!starter) throw new Error(`The ${preset.name} preset is no longer offered.`)
    if (isMessageChannel(preset.channel)) return { kind: 'message', channel: preset.channel, body: starter.sms_body ?? '', subject: starter.subject_line, media: null, findings: null }
    return { kind: 'email', html: starter.html_content ?? '', subject: starter.subject_line, preheader: starter.preheader }
  }

  const { template } = item
  if (isMessageChannel(template.channel)) {
    const message = await api.get<Message>(`/templates/${template.id}/message/`, undefined, signal)
    return { kind: 'message', channel: template.channel, body: message.sms_body, subject: message.subject_line, media: message.media_asset, findings: message.version_number > 0 ? message.findings : null }
  }
  const receipt = template.channel === 'E_RECEIPT'
  const [design, layout] = await Promise.all([
    api.get<Design>(`/templates/${template.id}/design/`, undefined, signal),
    receipt ? api.get<ReceiptLayout>(`/templates/${template.id}/receipt/`, undefined, signal) : null,
  ])
  const outer = design.html_content || (design.mjml_source ? await compile(design.mjml_source) : '')
  const html = layout && outer ? await withReceipt(outer, layout.sections) : outer
  return { kind: 'email', html, subject: design.subject_line, preheader: design.preheader, ...(layout ? { receipt: { preset: layout.layout_preset, sections: layout.sections } } : {}) }
}

function keyOf(item: PreviewItem) {
  return item.kind === 'preset' ? ['template-preview', 'preset', item.preset.key] : ['template-preview', 'template', item.template.id]
}

interface PreviewOptions {
  enabled?: boolean
}

export function usePreviewContent(item: PreviewItem, { enabled = true }: PreviewOptions = {}) {
  const queryClient = useQueryClient()
  const content = useQuery({
    queryKey: keyOf(item),
    queryFn: ({ signal }) => load(item, queryClient, signal),
    // a template is read fresh every time, so the preview is always its latest save; a preset never changes
    staleTime: item.kind === 'template' ? 0 : Infinity,
    enabled,
  })
  const tags = useQuery({
    queryKey: ['personalization-tags', 'all'],
    queryFn: ({ signal }) => api.get<Page<PersonalizationTag>>('/personalization-tags/', { page_size: 200 }, signal),
  })
  // tagsReady: the catalogue has answered (or failed), so tags can be filled in rather than shown raw
  return { ...content, tags: tags.data?.results ?? [], tagsReady: !tags.isPending }
}
