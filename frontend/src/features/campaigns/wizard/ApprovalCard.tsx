/**
 * Review & Publish, when the workspace requires approval: the author asks, someone with campaign.approve decides (never the
 * person who asked), and the production publish stays disabled until it is approved. The API says which of request_approval,
 * approve and send_back this reader may do (the campaign's `actions`), so the card offers exactly those.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Field, TextArea, buttonPrimary, buttonSecondary } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { Tag, type TagTone } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { Campaign } from '@/lib/types'

import { Panel } from '../parts'

export const APPROVAL_CARD_ID = 'approval-card'

const STATE: Record<string, { label: string; tone: TagTone }> = {
  NONE: { label: 'Required', tone: 'warning' },
  REQUESTED: { label: 'Awaiting Approval', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  RETURNED: { label: 'Sent Back', tone: 'error' },
}

type Decision = 'request-approval' | 'approve' | 'send-back'

export function ApprovalCard({ campaign }: { campaign: Campaign }) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const [asked, setAsked] = useState<Decision | null>(null)
  const act = useMutation({
    mutationFn: (decision: Decision) => api.post<Campaign>(`/campaigns/${campaign.id}/${decision}/`, { note: note.trim() }),
    onSuccess: async () => {
      setNote('')
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    },
    onSettled: () => setAsked(null),
  })

  const approval = campaign.approval
  const status = approval?.status ?? 'NONE'
  const can = (action: 'request_approval' | 'approve' | 'send_back') => campaign.actions.includes(action)
  const deciding = can('approve') || can('send_back')
  const run = (decision: Decision) => { setAsked(decision); act.mutate(decision) }
  const busy = (decision: Decision) => act.isPending && asked === decision

  return (
    <div id={APPROVAL_CARD_ID}>
      <Panel title="Approval" actions={<Tag tone={STATE[status].tone}>{STATE[status].label}</Tag>}>
        <div className="space-y-3 text-sm">
          {status === 'NONE' && <p className="text-ink-800">This workspace needs a second person to approve a production send. Ask for it here; everyone who can approve is emailed.</p>}
          {status === 'REQUESTED' && approval && (
            <div className="text-ink-800">
              <p><span className="font-semibold text-ink-900">{approval.requested_by_name ?? 'Someone'}</span> asked for approval <span className="cep-num">{formatDateTime(approval.requested_at)}</span>.</p>
              {approval.note && <blockquote className="mt-2 border-l-2 border-line pl-3 text-ink-800">{approval.note}</blockquote>}
            </div>
          )}
          {status === 'APPROVED' && approval && (
            <div className="text-ink-800">
              <p><span className="font-semibold text-ink-900">{approval.decided_by_name ?? 'Someone'}</span> approved it for production <span className="cep-num">{formatDateTime(approval.decided_at)}</span>. It can be published now.</p>
              {approval.decision_note && <blockquote className="mt-2 border-l-2 border-line pl-3">{approval.decision_note}</blockquote>}
            </div>
          )}
          {status === 'RETURNED' && approval && (
            <div className="text-ink-800">
              <p><span className="font-semibold text-ink-900">{approval.decided_by_name ?? 'Someone'}</span> sent it back <span className="cep-num">{formatDateTime(approval.decided_at)}</span>. Make the changes, then ask again.</p>
              {approval.decision_note && <blockquote className="mt-2 border-l-2 border-danger pl-3">{approval.decision_note}</blockquote>}
            </div>
          )}

          {can('request_approval') && (
            <>
              <Field label="Note to the Approver" hint="What to check, or why it is ready. Optional.">
                {(ids) => <TextArea {...ids} rows={3} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />}
              </Field>
              <button type="button" className={`${buttonPrimary} w-full`} disabled={act.isPending} onClick={() => run('request-approval')}>
                {busy('request-approval') && <Spinner size="sm" tone="onBrand" />}{status === 'RETURNED' ? 'Request Approval Again' : 'Request Approval'}
              </button>
            </>
          )}

          {deciding && (
            <>
              <Field label="Note" hint="Goes to the person who asked. Sending back needs one: say what to change.">
                {(ids) => <TextArea {...ids} rows={3} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />}
              </Field>
              <div className="flex gap-2">
                {can('send_back') && (
                  <button type="button" className={`${buttonSecondary} flex-1`} disabled={act.isPending || !note.trim()} onClick={() => run('send-back')}>
                    {busy('send-back') && <Spinner size="sm" />}Send Back
                  </button>
                )}
                {can('approve') && (
                  <button type="button" className={`${buttonPrimary} flex-1`} disabled={act.isPending} onClick={() => run('approve')}>
                    {busy('approve') && <Spinner size="sm" tone="onBrand" />}Approve
                  </button>
                )}
              </div>
            </>
          )}

          {status === 'REQUESTED' && !deciding && (
            <p className="text-ink-800">Waiting for someone who can approve. Nobody approves their own campaign.</p>
          )}
          {act.isError && <ErrorState title="That did not go through" error={act.error} />}
        </div>
      </Panel>
    </div>
  )
}
