/** "What the test population will actually receive." Email / SMS tabs over the journey's chosen message templates,
 * rendered with this repo's existing preview pieces — usePreviewContent (features/templates/preview) and
 * PhoneFrame (features/messaging) — not a new renderer. Both tabs always show; a channel the journey doesn't use is
 * disabled with the reason. MMS steps preview under SMS (they go out through SMS Master). */
import { useMemo, useState } from 'react'

import { Spinner } from '@/components/States'
import { tabId, tabPanelId } from '@/components/tabIds'
import { Tabs } from '@/components/Tabs'
import { DEFAULT_PROFILE, fillForPreview } from '@/features/designer/preview/previewProfiles'
import { BUBBLE, PhoneFrame } from '@/features/messaging/PhoneFrame'
import { resolvedText, usePreviewContent } from '@/features/templates/preview/usePreviewContent'
import type { JourneyGraphNode, Template } from '@/lib/types'

type PreviewTab = 'EMAIL' | 'SMS'

const TAB_LABEL: Record<PreviewTab, string> = { EMAIL: 'Email', SMS: 'SMS' }
const ROUTE: Record<PreviewTab, string> = { EMAIL: 'Mailer Master → Postal', SMS: 'SMS Master → Digivize' }
const tabOf = (type: string): PreviewTab => (type === 'EMAIL' ? 'EMAIL' : 'SMS')

export function ContentPreviewCard({ messageNodes }: { messageNodes: JourneyGraphNode[] }) {
  const byTab = useMemo(() => {
    const steps = new Map<PreviewTab, JourneyGraphNode[]>()
    for (const node of messageNodes) steps.set(tabOf(node.type), [...(steps.get(tabOf(node.type)) ?? []), node])
    return steps
  }, [messageNodes])
  const withTemplate = (tab: PreviewTab) => byTab.get(tab)?.find((node) => Boolean(node.config.template_id))
  const reason = (tab: PreviewTab) =>
    !byTab.has(tab) ? `This Journey has no ${TAB_LABEL[tab]} step.`
    : !withTemplate(tab) ? `No ${TAB_LABEL[tab]} step has a template chosen yet.`
    : undefined

  const firstOpen: PreviewTab = withTemplate('EMAIL') ? 'EMAIL' : 'SMS'
  const [active, setActive] = useState<PreviewTab>(firstOpen)
  const node = withTemplate(active)
  const anyTemplate = Boolean(withTemplate('EMAIL') || withTemplate('SMS'))

  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="font-display text-card-heading font-semibold text-ink-900">Content Preview</h2>
      <p className="mt-1 text-helper text-ink-800">What the test population will actually receive.</p>

      <div className="mt-3 flex border-b border-line">
        <Tabs
          label="Channel"
          idPrefix="content-preview"
          size="md"
          tabs={(['EMAIL', 'SMS'] as const).map((id) => ({ id, label: TAB_LABEL[id], disabledReason: reason(id) }))}
          value={active}
          onChange={setActive}
        />
      </div>

      <div role="tabpanel" id={tabPanelId('content-preview', active)} aria-labelledby={tabId('content-preview', active)}>
        {!anyTemplate ? (
          <p className="mt-4 text-helper text-ink-800">No Email or SMS step has a template chosen yet.</p>
        ) : node ? (
          <TemplateContentPreview key={String(node.config.template_id)} templateId={String(node.config.template_id)} channel={node.type} tab={active} />
        ) : null}
      </div>
    </section>
  )
}

function TemplateContentPreview({ templateId, channel, tab }: { templateId: string; channel: string; tab: PreviewTab }) {
  const template = { id: templateId, name: '', channel, status: 'ACTIVE' } as Template
  const preview = usePreviewContent({ kind: 'template', template })

  if (preview.isError) {
    return <p className="mt-4 text-helper text-danger-text">This template could not be loaded.</p>
  }
  if (!preview.data) {
    return (
      <p className="mt-4 flex items-center gap-2 text-helper text-ink-800">
        <Spinner size="sm" /> Building the preview
      </p>
    )
  }

  // the preview data carries no sender, so there is no From line; the subject shows when the template has one
  const subject = preview.data.subject?.trim() ? fillForPreview(preview.data.subject, preview.tags, DEFAULT_PROFILE, { escape: false }) : ''
  const header = (
    <dl className="space-y-1 border-b border-line bg-surface-subtle px-4 py-3 text-helper">
      {subject && <HeaderLine label="Subject" value={subject} />}
      <HeaderLine label="Sends via" value={ROUTE[tab]} />
    </dl>
  )

  if (preview.data.kind === 'email') {
    const html = fillForPreview(preview.data.html, preview.tags, DEFAULT_PROFILE)
    return (
      <div className="mt-4 overflow-hidden rounded-lg border border-line">
        {header}
        <div className="overflow-x-auto bg-surface">
          <iframe title="Email Preview" sandbox="" srcDoc={html} style={{ width: 600 }} className="mx-auto block h-[480px] max-w-none border-0 bg-surface" />
        </div>
      </div>
    )
  }
  const text = resolvedText(preview.data.body, preview.tags)
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-line">
      {header}
      <div className="bg-surface py-4">
        <PhoneFrame sender="Your Brand">
          {text.trim() ? (
            <p data-testid="preview-bubble" className={BUBBLE}>{text}</p>
          ) : (
            <p className="px-2 pt-10 text-center text-xs text-ink-800">This message has no text yet.</p>
          )}
        </PhoneFrame>
      </div>
    </div>
  )
}

function HeaderLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="shrink-0 text-ink-800">{label}:</dt>
      <dd className="min-w-0 truncate font-medium text-ink-900" title={value}>{value}</dd>
    </div>
  )
}
