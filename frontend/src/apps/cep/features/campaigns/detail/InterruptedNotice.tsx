/**
 * Resend Interrupted (option A of docs/mockups/resend-interrupted.html): above a finished run's recipients, the messages a
 * stopped send worker took and the engine never confirmed. Some may have reached the person, so C360 never sends them again
 * on its own; someone who can publish decides, once, in a dialog that says what may happen. After a resend, a line says who
 * did it and when.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Notice } from '@/components/Notice'
import { ErrorState, Spinner } from '@/components/States'
import { ChoiceCard, ChoiceGroup } from '@/apps/cep/features/campaigns/parts'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { RunInterrupted } from '@/lib/types'

import { dateTimeInZone } from '../zone'

const plural = (count: number, word: string) => `${formatNumber(count)} ${word}${count === 1 ? '' : 's'}`

export function InterruptedNotice({ runId, texts, zone, onShow }: { runId: string; texts: boolean; zone: string; onShow?: () => void }) {
  const { can } = useAuth()
  const [asking, setAsking] = useState(false)
  const query = useQuery({
    queryKey: ['campaign-runs', runId, 'interrupted'],
    queryFn: ({ signal }) => api.get<RunInterrupted>(`/campaign-runs/${runId}/interrupted/`, undefined, signal),
  })
  const data = query.data
  if (!data) return null
  const engine = data.engine || 'the engine'
  if (data.interrupted > 0 && data.can_resend) {
    const when = !data.first_at ? '' : data.last_at && data.last_at !== data.first_at
      ? `between ${dateTimeInZone(data.first_at, zone)} and ${dateTimeInZone(data.last_at, zone)}` : `on ${dateTimeInZone(data.first_at, zone)}`
    return (
      <>
        <Notice tone="warning" layout="strip"
          action={
            <span className="flex shrink-0 gap-2">
              {onShow && <button type="button" className={buttonSecondary} onClick={onShow}>Show Them</button>}
              {can('campaign.publish') && <button type="button" className={buttonPrimary} onClick={() => setAsking(true)}>Resend {formatNumber(data.interrupted)}</button>}
            </span>
          }>
          <strong className="font-semibold">{plural(data.interrupted, 'message')} {data.interrupted === 1 ? 'was' : 'were'} interrupted</strong> before {engine} confirmed {data.interrupted === 1 ? 'it' : 'them'}{when ? `, ${when}` : ''}.
          {' '}Some may have reached the {texts ? 'phone' : 'inbox'}. {data.interrupted === 1 ? 'It was' : 'They were'} not sent again.
        </Notice>
        {asking && <ResendDialog runId={runId} data={data} engine={engine} texts={texts} zone={zone} onClose={() => setAsking(false)} />}
      </>
    )
  }
  if (data.last_resend) {
    const by = data.last_resend.by ? ` by ${data.last_resend.by}` : ''
    return (
      <Notice tone="info" layout="strip">
        {plural(data.last_resend.count, 'interrupted message')} {data.last_resend.count === 1 ? 'was' : 'were'} sent again on {dateTimeInZone(data.last_resend.at, zone)}{by}.
      </Notice>
    )
  }
  return null
}

function ResendDialog({ runId, data, engine, texts, zone, onClose }: { runId: string; data: RunInterrupted; engine: string; texts: boolean; zone: string; onClose: () => void }) {
  const client = useQueryClient()
  const outside = Boolean(data.window_opens)
  const [atWindow, setAtWindow] = useState(outside)
  const resend = useMutation({
    mutationFn: () => api.post<RunInterrupted & { resent: number }>(`/campaign-runs/${runId}/interrupted/`, { at_window: atWindow }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['campaign-runs', runId] })
      onClose()
    },
  })
  const nothing = data.to_send <= 0
  return (
    <Modal title={`Resend ${plural(data.interrupted, 'Interrupted Message')}?`} onClose={onClose}
      footer={
        <>
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={resend.isPending} onClick={() => resend.mutate()}>
            {resend.isPending && <Spinner size="sm" tone="onBrand" />}{nothing ? 'Mark as Not Sent Again' : `Resend ${formatNumber(data.to_send)}`}
          </button>
        </>
      }>
      <div className="space-y-3 text-sm text-ink-800">
        <p>
          A send worker stopped while {data.interrupted === 1 ? 'this message was' : 'these messages were'} with {engine}, and {engine} never confirmed {data.interrupted === 1 ? 'it' : 'them'}.
          {' '}<strong className="font-semibold text-ink-900">Some may already have reached the {texts ? 'phone' : 'inbox'}</strong>; those people will get {texts ? 'the text' : 'the email'} twice.
        </p>
        <dl className="divide-y divide-line-subtle rounded-lg border border-line-subtle">
          {([['Interrupted', formatNumber(data.interrupted)],
             [`Reported delivered by ${engine} since`, `${formatNumber(data.delivered_since)} · left out`],
             ['Opted out, blocked or without consent since', `${formatNumber(data.held_back)} · left out`],
             ['To be sent again', formatNumber(Math.max(0, data.to_send))]] as const).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 px-3 py-2">
              <dt>{label}</dt>
              <dd className="cep-num font-medium text-ink-900">{value}</dd>
            </div>
          ))}
        </dl>
        {!nothing && outside && (
          <ChoiceGroup label="When">
            <ChoiceCard selected={!atWindow} onSelect={() => setAtWindow(false)} title="Send Now" text={`The ${formatNumber(data.to_send)} go out with the next batches of this engine.`} />
            <ChoiceCard selected={atWindow} onSelect={() => setAtWindow(true)} title="Send at the Next Send Window"
              text={`Outside the workspace's send window: ${dateTimeInZone(data.window_opens, zone)}.`} />
          </ChoiceGroup>
        )}
        {nothing && <p>None of them can be sent again; they stay as they are and the notice goes away.</p>}
        <p className="text-xs">Each message keeps its message key, so an engine that drops repeats of the same key sends it only once. Recorded in the campaign's activity log.</p>
        {resend.isError && <ErrorState title="Nothing was sent again" error={resend.error} />}
      </div>
    </Modal>
  )
}
