/**
 * Settings → Notifications: who hears about what, by email and by a chat webhook. The matrix is event × channel: the
 * campaign's owner by email, the fixed recipients by email, and the webhook. Mail goes through the workspace's own server
 * when it has one. A test uses the saved settings, so it is offered once the form matches what is stored.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { Field, TextArea, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { addressesOf } from '@/lib/addresses'
import { ApiError, api } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import type { NotificationChannels, NotificationSettings, NotificationTestResult } from '@/lib/types'

const KEY = ['workspace', 'notifications']
const CHANNELS: { key: keyof NotificationChannels; label: string }[] = [
  { key: 'owner', label: 'Owner by Email' },
  { key: 'recipients', label: 'Recipients by Email' },
  { key: 'webhook', label: 'Webhook' },
]

export function NotificationsPage() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.get<NotificationSettings>('/workspace/notifications/', undefined, signal) })
  if (settings.isError) return <ErrorState title="The notification settings could not be loaded" error={settings.error} onRetry={() => void settings.refetch()} />
  if (settings.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  return <NotificationsForm data={settings.data} onSaved={(next) => queryClient.setQueryData(KEY, next)} />
}

function NotificationsForm({ data, onSaved }: { data: NotificationSettings; onSaved: (next: NotificationSettings) => void }) {
  const [events, setEvents] = useState(data.events)
  const [emails, setEmails] = useState(data.emails.join(', '))
  const [webhook, setWebhook] = useState(data.webhook_url)

  const save = useMutation({
    mutationFn: () => api.put<NotificationSettings>('/workspace/notifications/', { events, emails: addressesOf(emails), webhook_url: webhook.trim() }),
    onSuccess: (next) => {
      onSaved(next)
      setEvents(next.events)
      setEmails(next.emails.join(', '))
      setWebhook(next.webhook_url)
      test.reset()
    },
  })
  const test = useMutation({
    mutationFn: () => api.post<NotificationTestResult>('/workspace/notifications/test/'),
    onSuccess: (result) => { if (result.webhook) onSaved({ ...data, webhook_tested_at: new Date().toISOString() }) },
  })

  const dirty = JSON.stringify(events) !== JSON.stringify(data.events) || JSON.stringify(addressesOf(emails)) !== JSON.stringify(data.emails) || webhook.trim() !== data.webhook_url
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const other = save.isError && Object.keys(errors).length === 0 ? save.error : null
  const toggle = (event: string, channel: keyof NotificationChannels) =>
    setEvents((was) => ({ ...was, [event]: { ...was[event], [channel]: !was[event]?.[channel] } }))
  const configured = data.emails.length > 0 || data.webhook_url !== ''

  return (
    <form noValidate className="space-y-5" onSubmit={(event: FormEvent) => { event.preventDefault(); save.mutate() }}>
      <div>
        <h2 className="font-display text-section-title font-semibold text-ink-900">Notifications</h2>
        <p className="mt-0.5 text-sm text-ink-800">What this workspace is told about, and where. Mail goes out through the workspace's own server when it has one.</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]">
        <section className="rounded-lg border border-line bg-surface">
          <h3 className="border-b border-line-subtle px-4 py-3 font-display text-card-heading font-semibold text-ink-900">Events</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Which channels each event is sent to</caption>
              <thead>
                <tr className="border-b border-line bg-surface-subtle">
                  <th scope="col" className="h-10 px-4 text-left text-xs font-semibold text-ink-900">Event</th>
                  {CHANNELS.map((channel) => <th key={channel.key} scope="col" className="h-10 px-3 text-center text-xs font-semibold whitespace-nowrap text-ink-900">{channel.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.catalogue.map((item) => (
                  <tr key={item.key} className="border-b border-line-subtle last:border-b-0">
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      <span className="block font-semibold text-ink-900">{item.label}</span>
                      <span className="block text-xs text-ink-800">{item.hint}</span>
                    </th>
                    {CHANNELS.map((channel) => (
                      <td key={channel.key} className="px-3 text-center">
                        <input type="checkbox" className="h-4 w-4 accent-brand-600" aria-label={`${item.label}: ${channel.label}`}
                          checked={Boolean(events[item.key]?.[channel.key])} onChange={() => toggle(item.key, channel.key)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {errors.events && <p role="alert" className="px-4 pb-3 text-xs font-medium text-danger-text">{errors.events}</p>}
        </section>

        <div className="space-y-5 self-start">
          <section className="rounded-lg border border-line bg-surface p-4">
            <h3 className="mb-3 font-display text-card-heading font-semibold text-ink-900">Recipients</h3>
            <Field label="Email Addresses" error={errors.emails} hint="Separated by commas, up to 20. They get the events ticked under Recipients by Email.">
              {(ids) => <TextArea {...ids} rows={3} value={emails} onChange={(event) => setEmails(event.target.value)} placeholder="marketing-ops@example.com" />}
            </Field>
          </section>

          <section className="rounded-lg border border-line bg-surface p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="font-display text-card-heading font-semibold text-ink-900">Chat Webhook</h3>
              {data.webhook_url && (data.webhook_tested_at ? <StatusBadge status="ACTIVE" label="Working" /> : <StatusBadge status="DRAFT" label="Not Tested" />)}
            </div>
            <Field label="Webhook URL" error={errors.webhook_url} help="Slack, Teams or anything that takes a text message. The events ticked under Webhook are posted here; Send a Test Message records when it last worked."
              hint={`Slack, Teams or anything that takes a JSON message with a text field.${data.webhook_tested_at ? ` Last worked ${formatDateTime(data.webhook_tested_at)}.` : ''}`}>
              {(ids) => <TextInput {...ids} type="url" value={webhook} onChange={(event) => setWebhook(event.target.value)} placeholder="https://hooks.slack.com/services/…" autoComplete="off" />}
            </Field>
          </section>
        </div>
      </div>

      {other && <ErrorState title="The notification settings were not saved" error={other} />}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={buttonPrimary} disabled={save.isPending || !dirty}>{save.isPending && <Spinner size="sm" tone="onBrand" />}Save</button>
        <button type="button" className={buttonSecondary} disabled={dirty || !configured || test.isPending} onClick={() => test.mutate()}>
          {test.isPending && <Spinner size="sm" />}Send a Test Message
        </button>
        {dirty ? <span className="text-helper text-ink-800">Save first: the test uses the saved settings.</span>
          : !configured ? <span className="text-helper text-ink-800">Add recipients or a webhook to send a test.</span>
          : save.isSuccess ? <span role="status" className="text-sm text-success-text">Saved</span> : null}
      </div>
      {test.data && (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${test.data.webhook_configured && !test.data.webhook ? 'bg-warning-bg text-warning-text' : 'bg-surface-subtle text-ink-800'}`}>
          {[
            test.data.emails_configured ? `Test email sent to ${test.data.email} of ${test.data.emails_configured} recipient${test.data.emails_configured === 1 ? '' : 's'}.` : null,
            test.data.webhook_configured ? (test.data.webhook ? 'The webhook accepted the test message.' : 'The webhook refused the test message or did not answer. Check the address.') : null,
          ].filter(Boolean).join(' ')}
        </p>
      )}
      {test.isError && <ErrorState title="The test was not sent" error={test.error} />}
    </form>
  )
}
