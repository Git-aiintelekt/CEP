/**
 * Read-only preview of a C360 starter or a saved template: its flow drawn with the canvas's own cards, who can enter, its goal,
 * channels and steps. Nothing is copied until Use This Template, which hands it to the Setup pop-up. A saved template can be
 * deleted here (journey.edit); journeys made from it keep working.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { lazy, Suspense, useState, type ReactNode } from 'react'

import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { Notice } from '@/components/Notice'
import { Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { JourneyStarter } from '@/lib/types'

import type { CardTag } from '../canvasLayout'
import { fromWireGraph, isNodeConfigured, type EditorNode } from '../graphModel'
import { CATEGORY, NODE_META, type AddableType } from '../nodeDefs'
import { entrySetupNote, populationText, reentryText, stepName, stepsOf, triggerSentence, unconfiguredSteps } from './templateMeta'
import { SAVED_TEMPLATES_KEY } from './templateApi'
import { CategoryChip, ChannelIcons, TemplateKindTag } from './TemplateParts'
import { CHANNEL_META } from '../channelMeta'

// @xyflow/react stays out of the Journeys list's bundle until a preview opens
const JourneyFlowPreview = lazy(() => import('../JourneyCanvas').then((module) => ({ default: module.JourneyFlowPreview })))

function starterTag(node: EditorNode): CardTag {
  return isNodeConfigured(node) ? null : 'needs-setup'
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-line-subtle py-3 first:pt-0 last:border-b-0">
      <dt className="text-xs font-semibold text-ink-800">{label}</dt>
      <dd className="mt-1 text-sm text-ink-900">{children}</dd>
    </div>
  )
}

interface PreviewProps {
  starter: JourneyStarter
  /** journey.edit: Use This Template */
  canEdit: boolean
  onClose: () => void
  onUse: (starter: JourneyStarter) => void
}

export function JourneyTemplatePreviewModal({ starter: current, canEdit, onClose, onUse }: PreviewProps) {
  const rule = current.graph.entry_rules[0]
  const steps = stepsOf(current.graph)
  const needsSetup = unconfiguredSteps(current.graph)
  const setupNote = entrySetupNote(rule)
  const saved = current.saved
  const toast = useToast()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const remove = useMutation({
    mutationFn: () => api.delete(`/journey-templates/${current.template_id}/`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SAVED_TEMPLATES_KEY })
      toast.success(`“${current.name}” is deleted. Journeys made from it keep working.`)
      onClose()
    },
  })

  const badge = (
    <span className="flex flex-wrap items-center gap-2">
      <CategoryChip category={current.category} />
      <TemplateKindTag starter={current} />
    </span>
  )

  const footer = confirmDelete ? (
    <>
      <span className="mr-auto text-sm text-ink-900">Delete this template? Journeys made from it keep working.</span>
      <Button onClick={() => setConfirmDelete(false)}>Keep</Button>
      <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Delete Template</Button>
    </>
  ) : (
    <>
      {canEdit && saved && <Button onClick={() => setConfirmDelete(true)} disabled={remove.isPending}>Delete Template</Button>}
      <Button onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</Button>
      {canEdit && <Button variant="primary" onClick={() => onUse(current)}>Use This Template</Button>}
    </>
  )

  return (
    <Modal title={current.name} subtitle={current.description ?? undefined} badge={badge} onClose={onClose} size="screen" scrollBody footer={footer}>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="Flow" className="flex min-w-0 flex-col">
          <h3 className="text-card-title font-semibold text-ink-900">Flow</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-helper text-ink-800">
            <Eye size={14} strokeWidth={1.5} aria-hidden /> Read-only preview. Nothing is copied yet.
          </p>
          <div className="mt-3 h-[max(420px,calc(100dvh-22rem))] overflow-hidden rounded-lg border border-line">
            <Suspense fallback={<p className="flex h-full items-center justify-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Drawing the flow</p>}>
              <JourneyFlowPreview
                root={fromWireGraph(current.graph)}
                entryTrigger={triggerSentence(rule)}
                entryDetail={setupNote ?? `${populationText(current)} · Re-entry: ${reentryText(current)}`}
                tagFor={starterTag}
              />
            </Suspense>
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          <dl>
            <Fact label="Who Can Enter">
              {populationText(current)}
              <span className="block text-helper text-ink-800">Re-entry: {reentryText(current)}</span>
            </Fact>
            <Fact label="Goal">{current.goal || <span className="text-ink-300">Not set</span>}</Fact>
            <Fact label="Channels">
              {current.channels.length === 0 ? <span className="text-ink-300">None</span> : (
                <span className="flex flex-wrap items-center gap-3">
                  <ChannelIcons channels={current.channels} />
                  <span>{current.channels.map((channel) => CHANNEL_META[channel]?.label ?? channel).join(', ')}</span>
                </span>
              )}
            </Fact>
            <Fact label="Steps">{steps.length} {steps.length === 1 ? 'step' : 'steps'} after the entry trigger</Fact>
            {saved && (
              <Fact label="Saved">
                {formatDate(saved.created_at)}{saved.created_by_name ? ` by ${saved.created_by_name}` : ''}
                <span className="block text-helper text-ink-800">{saved.used_count === 0 ? 'No journey made from it yet' : `${saved.used_count} ${saved.used_count === 1 ? 'journey' : 'journeys'} made from it`}</span>
              </Fact>
            )}
          </dl>

          {remove.isError && <p role="alert" className="text-sm font-medium text-danger-text">The template was not deleted.</p>}
          {(needsSetup.length > 0 || !saved) && <Notice tone="info" layout="banner" title={`${needsSetup.length} ${needsSetup.length === 1 ? 'step needs' : 'steps need'} setup`}>
            <p>These steps arrive empty. In Build, you choose your workspace’s own email and SMS content and the coupon to issue.</p>
            {needsSetup.length > 0 && (
              <ul aria-label="Steps That Need Setup" className="mt-3 flex flex-col gap-2">
                {needsSetup.map((node) => {
                  const meta = NODE_META[node.type as AddableType]
                  const category = CATEGORY[meta?.category ?? 'CONTROL']
                  const Icon = meta?.icon
                  return (
                    <li key={node.key} className="flex items-center gap-2 text-sm text-ink-900">
                      <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-sm ${category.tile}`}>{Icon && <Icon size={14} strokeWidth={1.5} />}</span>
                      <span className="min-w-0 truncate">{stepName(node)}</span>
                      <span className="ml-auto shrink-0 text-xs text-ink-800">{meta?.label ?? node.type}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Notice>}

          {canEdit && <p className="text-helper text-ink-800">Use This Template creates a new draft journey. The template itself doesn’t change.</p>}
        </div>
      </div>
    </Modal>
  )
}
