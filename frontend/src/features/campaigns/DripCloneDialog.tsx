/**
 * Clone for a drip: a pop-up in the shared create frame that names the copy and sets its start date, then opens the
 * copy's Sequence step. POST /clone/ {name, scheduled_at}: the API copies every message with its day, subject and own
 * template copy, and the audience, and publishes nothing. Other campaigns clone at once, as before.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { DatePicker } from '@/components/DatePicker'
import { Field, TextInput } from '@/components/Form'
import { SetupDialog } from '@/components/SetupDialog'
import { useToast } from '@/components/Toast'
import { problemText } from '@/features/contact-lists/problem'
import { api, ApiError } from '@/lib/api'
import type { Campaign } from '@/lib/types'

import { seriesOf } from './dripSequence'
import { setupHref } from './setupFlow'
import { zonedToIso } from './zone'

const CHOOSE_DATE = 'Choose a start date.'

export function DripCloneDialog({ campaign, workspaceZone, onClose }: { campaign: Campaign; workspaceZone: string; onClose: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const series = seriesOf(campaign, workspaceZone)
  const [name, setName] = useState(`Copy of ${campaign.name}`)
  const [start, setStart] = useState('')
  const [tried, setTried] = useState(false)
  const count = campaign.drip_summary?.count ?? campaign.drip_progress?.total ?? 0

  const clone = useMutation({
    mutationFn: () => api.post<Campaign>(`/campaigns/${campaign.id}/clone/`, { name: name.trim(), scheduled_at: zonedToIso(`${start}T${series.time}`, series.zone) }),
    onSuccess: async (copy) => {
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      toast.success('Copy created. Check the messages, then test and publish.')
      navigate(setupHref(copy.id, { step: 'sequence' }))
    },
  })
  const fields = clone.error instanceof ApiError && clone.error.status === 400 ? clone.error.fieldErrors : {}
  const nameError = !name.trim() && tried ? 'Enter a name.' : fields.name
  const dateError = !start && tried ? CHOOSE_DATE : fields.scheduled_at
  const other = clone.error && !fields.name && !fields.scheduled_at ? clone.error : null

  function submit() {
    setTried(true)
    if (!name.trim() || !start) return
    clone.mutate()
  }

  return (
    <SetupDialog title={`Clone ${campaign.name}`} onClose={onClose} locked={clone.isPending}
      primary={{ label: 'Clone Campaign', onClick: submit, busy: clone.isPending, busyLabel: 'Cloning' }}
      error={other ? { title: 'The campaign was not cloned', message: problemText(other) } : null}>
      {/* tall enough that the start date's calendar opens without being cut off by the footer */}
      <div className="flex min-h-[312px] flex-col gap-6">
        <Field label="Campaign Name" strong error={nameError}>
          {(ids) => <TextInput {...ids} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <div className="flex flex-col gap-1.5" data-clone-start>
          <span className="text-sm font-semibold text-ink-900">Start Date</span>
          <DatePicker label="Start Date" value={start} placeholder="Choose a Start Date" onChange={setStart} />
          {dateError ? (
            <p role="alert" className="flex items-start gap-1.5 text-helper font-medium text-danger-text">
              <CircleAlert size={16} strokeWidth={1.5} aria-hidden className="mt-px shrink-0" />{dateError}
            </p>
          ) : (
            <p className="cep-num text-helper text-ink-800">Day 0 sends on this date at {series.time} {series.zoneShort}.</p>
          )}
        </div>
        <p className="text-sm text-pretty text-ink-800">
          {count === 1 ? 'The message is copied with its day, subject and its own template copy.'
            : `All ${count ? `${count} ` : ''}messages are copied with their days, subjects and their own template copies.`}
          {' '}The audience is copied too. Nothing is published.
        </p>
      </div>
    </SetupDialog>
  )
}
