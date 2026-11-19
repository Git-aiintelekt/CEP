/**
 * Development only (/dev/upgrade?state=scheduled|upgrading|reconnecting|done, not registered in production builds): the
 * upgrade notice the app shell shows, on a campaign being edited, with no backend. The page answers /platform-status/ and
 * /version.json itself for the state chosen; the shell's notice then behaves as it does in a workspace.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/Button'
import { Field, TextInput } from '@/components/Form'
import { PLATFORM_STATUS_KEY } from '@/lib/upgradeNotice'

const STATES = ['scheduled', 'upgrading', 'reconnecting', 'done'] as const
type State = (typeof STATES)[number]
const NAMES: Record<State, string> = { scheduled: 'Before', upgrading: 'During', reconnecting: 'Reconnecting', done: 'After' }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function answer(state: State, url: string): Response | null {
  const now = Date.now()
  if (url.includes('/platform-status/')) {
    if (state === 'reconnecting') return new Response('Bad Gateway', { status: 502 })
    if (state === 'scheduled') return json({ upgrade: { state: 'SCHEDULED', starts_at: new Date(now + 3 * 60 * 60_000).toISOString(), minutes: 10, note: 'New Delivery Warm-Up reports.', changed_at: new Date(now).toISOString() } })
    if (state === 'upgrading') return json({ upgrade: { state: 'UPGRADING', minutes: 10, changed_at: new Date(now).toISOString() } })
    return json({ upgrade: { state: 'DONE', version: 'v1.2.2', changed_at: new Date(now).toISOString() } })
  }
  if (url.includes('version.json')) return state === 'done' ? json({ version: 'v1.2.2' }) : json({ detail: 'Not found' }, 404)
  return null
}

export default function UpgradePlayground() {
  const [params, setParams] = useSearchParams()
  const state = (STATES as readonly string[]).includes(params.get('state') ?? '') ? (params.get('state') as State) : 'scheduled'
  const client = useQueryClient()
  const [subject, setSubject] = useState('Up to 40% off this weekend')

  useEffect(() => {
    const real = window.fetch
    window.fetch = async (input, init) => answer(state, String(input instanceof Request ? input.url : input)) ?? real(input, init)
    void client.refetchQueries({ queryKey: PLATFORM_STATUS_KEY })
    if (state === 'done') window.dispatchEvent(new Event('focus'))
    return () => {
      window.fetch = real
    }
  }, [state, client])

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-wrap gap-2" aria-label="States">
        {STATES.map((key) => (
          <Button key={key} variant={key === state ? 'primary' : 'secondary'} onClick={() => setParams({ state: key })}>{NAMES[key]}</Button>
        ))}
      </div>
      <div>
        <p className="text-helper text-ink-800">Campaigns › Spring Sale</p>
        <h1 className="font-display text-page-title font-semibold text-ink-900">Spring Sale</h1>
      </div>
      <Field label="Subject">{(ids) => <TextInput {...ids} value={subject} onChange={(event) => setSubject(event.target.value)} />}</Field>
      <Field label="Preheader">{(ids) => <TextInput {...ids} defaultValue="Three days only, in every store" />}</Field>
      <div className="flex items-center justify-end gap-2">
        <span className="text-helper text-ink-700">Unsaved changes</span>
        <Button variant="secondary">Cancel</Button>
        <Button variant="primary">Save</Button>
      </div>
    </div>
  )
}
