/**
 * Test publish: the current content goes to internal people only. It creates a test run that counts for nothing
 * in the results, and moves a draft to Test Published. Used by the wizard's Test step and by the detail page.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { CircleCheck } from 'lucide-react'

import { Button } from '@/components/Button'
import { Field, TextInput } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { problemText } from '@/features/contact-lists/problem'
import { api } from '@/lib/api'
import type { Campaign, CampaignFormOptions, TestPublishResult } from '@/lib/types'

import { testIsOn } from './subjectTest'
import { rowsOf, useTestRecipients, type DripTestAnswer, type TestRecipients } from './testRecipients'

/** the picker: People of This Workspace (email only) and Other Addresses / Mobile Numbers, with the send button beside the field */
export function TestRecipientFields({ recipients, people, onEnter, action }: { recipients: TestRecipients; people: CampaignFormOptions['owners']; onEnter: () => void; action: ReactNode }) {
  const { texts, to, setTo, userIds, setUserIds } = recipients
  return (
    <>
      {!texts && people.length > 0 && (
        <fieldset className="mt-3 min-w-0">
          <legend className="text-sm font-medium text-ink-800">People of This Workspace</legend>
          <div className="mt-1 grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
            {people.map((person) => (
              <label key={person.id} className="flex items-center gap-2 text-sm text-ink-900">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={userIds.includes(person.id)}
                  onChange={(event) => setUserIds((current) => (event.target.checked ? [...current, person.id] : current.filter((item) => item !== person.id)))} />
                <span className="truncate">{person.name} <span className="text-ink-800">{person.email}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Field label={texts ? 'Mobile Numbers' : 'Other Addresses'} hint={texts ? 'With country code, e.g. +14045550100. Up to 20, separated by commas.' : 'Up to 20, separated by commas.'}>
            {(ids) => <TextInput {...ids} value={to} onChange={(event) => setTo(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onEnter() } }} placeholder={texts ? 'e.g. +14045550100, +14045550101' : 'e.g. you@example.com, colleague@example.com'} />}
          </Field>
        </div>
        <div className="mb-5">{action}</div>
      </div>
    </>
  )
}

/**
 * `url`: where the test goes instead of the campaign's test-publish (a drip message's own test, /steps/{step}/test/);
 * `intro`: the line that replaces the default one above the recipients.
 */
export function TestPublishBox({ campaign, people, defaultTo = '', onSent, url, intro }: {
  campaign: Campaign; people: CampaignFormOptions['owners']; defaultTo?: string; onSent?: () => void; url?: string; intro?: string
}) {
  const queryClient = useQueryClient()
  const recipients = useTestRecipients(campaign, defaultTo)

  const send = useMutation({
    mutationFn: async () => rowsOf(await api.post<TestPublishResult | DripTestAnswer>(url ?? `/campaigns/${campaign.id}/test-publish/`, recipients.body())),
    onSuccess: async (rows) => {
      await queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      if (rows.some((item) => item.ok)) onSent?.()
    },
  })
  const blocked = !campaign.template ? 'Choose a template first.' : !campaign.sender_profile ? 'Choose a sender first.' : ''
  const ready = !send.isPending && !blocked && recipients.chosen
  const allSent = send.data?.every((result) => result.ok) ?? false

  return (
    // not a <form>: the wizard's step is one already, and forms do not nest
    <div role="group" aria-label="Send a Test">
      <p className="text-sm text-ink-800">
        {intro ?? <>Goes out now through the campaign's sender, with sample values in place of personal data, marked [TEST]. It is recorded as a test run and never counts towards the results.
        {testIsOn(campaign.ab_config) && ' With the subject line test on, each address gets both, marked [TEST A] and [TEST B].'}</>}
      </p>
      <TestRecipientFields recipients={recipients} people={people} onEnter={() => { if (ready) send.mutate() }}
        action={<Button variant="primary" disabled={!ready} loading={send.isPending} onClick={() => send.mutate()}>Send Test</Button>} />
      {blocked && <p className="text-xs text-ink-800">{blocked}</p>}
      {send.isError && <div className="mt-3"><Notice tone="error" layout="box"><p className="font-semibold">The test was not sent</p><p>{problemText(send.error)}</p></Notice></div>}
      {send.data && (
        <div className="mt-3">
          <Notice tone={allSent ? 'info' : 'warning'} layout="box" icon={allSent ? CircleCheck : undefined} iconClass={allSent ? 'text-success' : undefined}>
            <ul className="space-y-0.5" aria-label="Test results">
              {send.data.map((result) => (
                <li key={`${result.to}-${result.variant ?? ''}`} className={result.ok ? '' : 'font-semibold'}>
                  {result.ok ? 'Sent to' : 'Not sent to'} {result.to}{result.variant ? ` (subject ${result.variant})` : ''}{!result.ok && result.detail ? `: ${result.detail}` : ''}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      )}
    </div>
  )
}
