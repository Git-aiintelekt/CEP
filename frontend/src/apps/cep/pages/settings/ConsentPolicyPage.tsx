/**
 * Settings → Consent Policy: what an upload does with people who have no consent date, whether a text list needs a text consent
 * date for every number, whether a fresh upload must be approved before any campaign sends to it, the consent lifetime (stored
 * for the reminder that is still to come) and the sentence the uploader confirms.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { buttonPrimary, Field, Select, TextArea } from '@/components/Form'
import { SaveTick } from '@/components/SaveTick'
import { ErrorState, Spinner } from '@/components/States'
import { Switch } from '@/components/Switch'
import { useToast } from '@/components/Toast'
import { api } from '@/lib/api'
import type { ConsentPolicy } from '@/lib/types'

import { problemText } from '@/apps/cep/features/contact-lists/problem'

const CONSENT_POLICY_KEY = ['workspace', 'consent-policy']

/** tick: the "Saved" confirmation, just before the control */
function Setting({ title, text, tick, children, id }: { title: string; text: string; tick?: React.ReactNode; children: React.ReactNode; id: string }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-line-subtle py-4 last:border-b-0">
      <div className="min-w-0 max-w-xl">
        <p id={`${id}-title`} className="text-sm font-semibold text-ink-900">{title}</p>
        <p id={`${id}-help`} className="text-sm text-ink-800">{text}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">{tick}{children}</div>
    </div>
  )
}

export function ConsentPolicyPage() {
  const queryClient = useQueryClient()
  const policy = useQuery({ queryKey: CONSENT_POLICY_KEY, queryFn: ({ signal }) => api.get<ConsentPolicy>('/workspace/consent-policy/', undefined, signal) })
  const save = useMutation({
    mutationFn: (body: Partial<ConsentPolicy>) => api.put<ConsentPolicy>('/workspace/consent-policy/', body),
    onSuccess: (next) => queryClient.setQueryData(CONSENT_POLICY_KEY, next),
  })

  if (policy.isError) return <ErrorState title="The consent policy could not be loaded" error={policy.error} onRetry={() => void policy.refetch()} />
  if (policy.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = policy.data

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-section-title font-semibold text-ink-900">Consent Policy</h2>
        <p className="mt-0.5 text-sm text-ink-800">
          How contacts come in. Every upload declares where its people agreed and the uploader confirms it; these settings decide what happens to people without a consent
          date, and whether a fresh upload needs approval before a campaign sends to it. The send engine still decides for real at send time.
        </p>
      </div>

      <section aria-label="Consent Policy Settings" className="max-w-3xl rounded-lg border border-line bg-surface px-5">
        <Setting id="without" title="People Without Consent" tick={<SaveTick mutation={save} field="without_consent" />} text="What an upload does with a new person who has no consent date in the file.">
          <Select aria-labelledby="without-title" aria-describedby="without-help" value={data.without_consent} disabled={save.isPending}
            onChange={(event) => save.mutate({ without_consent: event.target.value as ConsentPolicy['without_consent'] })}>
            <option value="HOLD_BACK">Import and hold back until they confirm</option>
            <option value="REFUSE">Refuse the row</option>
          </Select>
        </Setting>
        <Setting id="texts" title="Texts Need a Consent Date" tick={<SaveTick mutation={save} field="texts_need_date" />} text="A Texts or Email and Texts list cannot import a number without a text consent date in the file. Marketing texts need an express opt-in.">
          <Switch checked={data.texts_need_date} disabled={save.isPending} onChange={(next) => save.mutate({ texts_need_date: next })} labelledBy="texts-title" describedBy="texts-help" />
        </Setting>
        <Setting id="approval" title="Approval Before First Send" tick={<SaveTick mutation={save} field="approval_before_send" />} text="A new upload must be approved by someone with Consent · Edit before any campaign sends to its list. Until then its people are held back as In a List Awaiting Approval.">
          <Switch checked={data.approval_before_send} disabled={save.isPending} onChange={(next) => save.mutate({ approval_before_send: next })} labelledBy="approval-title" describedBy="approval-help" />
        </Setting>
        <Setting id="lifetime" title="Consent Lifetime" tick={<SaveTick mutation={save} field="lifetime_months" />} text="How long implied consent lasts without a purchase. Kept on the compliance record; the reminder before it lapses is still to come.">
          <Select aria-labelledby="lifetime-title" aria-describedby="lifetime-help" value={String(data.lifetime_months)} disabled={save.isPending}
            onChange={(event) => save.mutate({ lifetime_months: Number(event.target.value) })}>
            {data.lifetimes.map((months) => <option key={months} value={months}>{months % 12 === 0 ? `${months / 12} year${months === 12 ? '' : 's'}` : `${months} months`}</option>)}
          </Select>
        </Setting>
        {save.isError && <div className="py-4"><ErrorState title="The setting was not changed" error={save.error} /></div>}
      </section>

      <AttestationCard data={data} onSaved={(next) => queryClient.setQueryData(CONSENT_POLICY_KEY, next)} />
    </div>
  )
}

function AttestationCard({ data, onSaved }: { data: ConsentPolicy; onSaved: (next: ConsentPolicy) => void }) {
  const [text, setText] = useState(data.attestation)
  const [problem, setProblem] = useState('')
  const toast = useToast()
  const save = useMutation({
    mutationFn: () => api.put<ConsentPolicy>('/workspace/consent-policy/', { attestation: text }),
    onSuccess: (next) => { setProblem(''); toast.success('Wording saved', 'Uploaders confirm the new sentence from their next upload.'); onSaved(next) },
    onError: (error) => setProblem(problemText(error)),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    save.mutate()
  }
  return (
    <form onSubmit={submit} className="max-w-3xl rounded-lg border border-line bg-surface p-5">
      <h3 className="font-display text-card-heading font-semibold text-ink-900">Attestation Wording</h3>
      <p className="mt-1 mb-4 text-sm text-ink-800">The sentence the uploader confirms on the Consent step. It is shown on every compliance record. <code className="rounded-sm bg-surface-sunken px-1 text-xs">{'{workspace}'}</code> becomes the workspace's name.</p>
      <Field label="Sentence" required limit={{ used: text.length, max: 300 }} error={problem || undefined}>
        {(ids) => <TextArea {...ids} value={text} onChange={(event) => setText(event.target.value)} rows={2} maxLength={300} />}
      </Field>
      <p className="mt-2 text-sm text-ink-800">Reads as: <span className="font-medium text-ink-900">{text.replace('{workspace}', data.workspace_name)}</span></p>
      <div className="mt-4 flex justify-end">
        <button type="submit" className={buttonPrimary} disabled={save.isPending || text.trim() === '' || text === data.attestation}>Save Wording</button>
      </div>
    </form>
  )
}
