/**
 * Test publish: the current content goes to internal people only. It creates a test run that counts for nothing
 * in the results, and moves a draft to Test Published. Used by the wizard's Test step and by the detail page.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { buttonSecondary, Field, TextInput } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { api } from '@/lib/api'
import type { Campaign, CampaignFormOptions } from '@/lib/types'

import { isText } from './vocabulary'

interface TestResult { run: string; status: string; results: { to: string; ok: boolean; detail: string | null }[] }

export function TestPublishBox({ campaign, people, defaultTo = '' }: { campaign: Campaign; people: CampaignFormOptions['owners']; defaultTo?: string }) {
  const queryClient = useQueryClient()
  const texts = isText(campaign)
  const [to, setTo] = useState(texts ? '' : defaultTo)
  const [userIds, setUserIds] = useState<string[]>([])

  const send = useMutation({
    mutationFn: () => api.post<TestResult>(`/campaigns/${campaign.id}/test-publish/`, { to: to.split(/[\s,;]+/).filter(Boolean), user_ids: userIds }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  })
  const blocked = !campaign.template ? 'Choose a template first.' : !campaign.sender_profile ? 'Choose a sender first.' : ''
  const ready = !send.isPending && !blocked && (to.trim() !== '' || userIds.length > 0)

  return (
    // not a <form>: the wizard's step is one already, and forms do not nest
    <div role="group" aria-label="Send a test">
      <p className="text-sm text-ink-500">
        Goes out now through the campaign's sender, with sample values in place of personal data, marked [TEST]. It is recorded as a test run and never counts towards the results.
      </p>
      {!texts && people.length > 0 && (
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-ink-700">People of this workspace</legend>
          <div className="mt-1 grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
            {people.map((person) => (
              <label key={person.id} className="flex items-center gap-2 text-sm text-ink-900">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={userIds.includes(person.id)}
                  onChange={(event) => setUserIds((current) => (event.target.checked ? [...current, person.id] : current.filter((item) => item !== person.id)))} />
                <span className="truncate">{person.name} <span className="text-ink-500">{person.email}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Field label={texts ? 'Mobile numbers' : 'Other addresses'} hint={texts ? 'With country code, e.g. +14045550100. Up to 20, separated by commas.' : 'Up to 20, separated by commas.'}>
            {(ids) => <TextInput {...ids} value={to} onChange={(event) => setTo(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (ready) send.mutate() } }} placeholder={texts ? '+14045550100, +14045550101' : 'you@example.com, colleague@example.com'} />}
          </Field>
        </div>
        <button type="button" className={`${buttonSecondary} mb-5`} disabled={!ready} onClick={() => send.mutate()}>
          {send.isPending && <Spinner className="h-4 w-4" />}Send test
        </button>
      </div>
      {blocked && <p className="text-xs text-ink-500">{blocked}</p>}
      {send.isError && <div className="mt-3"><ErrorState title="The test was not sent" error={send.error} /></div>}
      {send.data && (
        <ul className="mt-3 space-y-1 text-sm" aria-label="Test results">
          {send.data.results.map((result) => (
            <li key={result.to} className={result.ok ? 'text-success-text' : 'text-danger-text'}>{result.ok ? 'Sent to' : 'Not sent to'} {result.to}{!result.ok && result.detail ? `: ${result.detail}` : ''}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
