/**
 * The Test step's subject line test: the campaign's subject (its own, else the template's) is A, a second one is B. A sample of the audience is split
 * between them, the rest wait, and after the wait the winner goes to the rest. Off by default; saved on the campaign as
 * `ab_config`, which the send engine reads. Email only (a text has no subject).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Field, Select, TextInput, buttonPrimary } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { Switch } from '@/components/Switch'
import { ApiError, api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { AbConfig, Campaign, CampaignAudience } from '@/lib/types'

import { Panel } from '../parts'
import { AB_DEFAULTS, DECIDE_CHOICES, METRIC_CHOICES, SAMPLE_CHOICES, metricText, waitText } from '../subjectTest'
import { useCampaignPreview } from '../useCampaignPreview'

interface Draft {
  enabled: boolean
  subject_b: string
  sample_pct: number
  metric: 'OPEN_RATE' | 'CLICK_RATE'
  decide_after_minutes: number
}

const draftOf = (config: AbConfig | null): Draft => ({
  enabled: Boolean(config?.enabled),
  subject_b: config?.subject_b ?? '',
  sample_pct: config?.sample_pct ?? AB_DEFAULTS.sample_pct,
  metric: config?.metric ?? AB_DEFAULTS.metric,
  decide_after_minutes: config?.decide_after_minutes ?? AB_DEFAULTS.decide_after_minutes,
})

export function SubjectTestCard({ campaign }: { campaign: Campaign }) {
  const queryClient = useQueryClient()
  const saved = draftOf(campaign.ab_config)
  const [draft, setDraft] = useState<Draft>(saved)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((was) => ({ ...was, [key]: value }))
  const preview = useCampaignPreview(campaign.id)
  const audience = useQuery({
    queryKey: ['campaigns', 'audience', campaign.id, campaign.row_version],
    queryFn: ({ signal }) => api.get<CampaignAudience>(`/campaigns/${campaign.id}/audience/`, undefined, signal),
    enabled: draft.enabled && campaign.contact_lists.length > 0,
  })
  const save = useMutation({
    mutationFn: () => api.patch<Campaign>(`/campaigns/${campaign.id}/`, { ab_config: { ...draft, subject_b: draft.subject_b.trim() }, row_version: campaign.row_version }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  })

  const dirty = JSON.stringify({ ...draft, subject_b: draft.subject_b.trim() }) !== JSON.stringify(saved)
  const errors = save.error instanceof ApiError && save.error.status === 400 ? save.error.fieldErrors : {}
  const other = save.isError && !errors.ab_config ? save.error : null
  const people = audience.data?.estimated_recipients
  const sample = people !== undefined ? Math.round((people * draft.sample_pct) / 100) : null
  const subjectA = preview.data?.subject ?? null

  return (
    <Panel title="Subject Line Test" actions={<Tag tone="brand">A/B</Tag>}
      description="Try a second subject line on a sample of the audience; the one that does better goes to everyone else.">
      <div className="space-y-4">
        <Switch checked={draft.enabled} onChange={(on) => set('enabled', on)} label="Test a Second Subject Line" />
        {draft.enabled && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label={campaign.subject_line ? 'A · Set for This Campaign' : 'A · From the Template'}
                hint={`Change it on the Content step. Shown with sample values. Gets ${draft.sample_pct / 2}% of the audience.`}>
                {(ids) => <TextInput {...ids} value={subjectA ?? (preview.isPending ? 'Loading' : 'No subject in the template yet')} readOnly disabled />}
              </Field>
              <Field label="B" required error={errors.ab_config} hint={`Tags such as {{first_name}} work here too. Gets ${draft.sample_pct / 2}% of the audience.`}>
                {(ids) => <TextInput {...ids} value={draft.subject_b} maxLength={300} onChange={(event) => set('subject_b', event.target.value)} placeholder="A second subject line to try" />}
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Sample" help="The share of the audience that gets the test, half A and half B. The rest wait for the winner. Fewer than 20 people in the run: no split, everyone gets A." hint={sample !== null ? `About ${formatNumber(sample)} people. The rest wait for the winner.` : 'The rest wait for the winner.'}>
                {(ids) => <Select {...ids} value={draft.sample_pct} onChange={(event) => set('sample_pct', Number(event.target.value))}>
                  {SAMPLE_CHOICES.map((pct) => <option key={pct} value={pct}>{pct}% of the Audience</option>)}
                </Select>}
              </Field>
              <Field label="Winner Decided By">
                {(ids) => <Select {...ids} value={draft.metric} onChange={(event) => set('metric', event.target.value as Draft['metric'])}>
                  {METRIC_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
                </Select>}
              </Field>
              <Field label="Decide After" help="How long after the sample goes out the winner is chosen by the metric per message sent; a tie within one point goes to A. The held messages then go with the winning subject.">
                {(ids) => <Select {...ids} value={draft.decide_after_minutes} onChange={(event) => set('decide_after_minutes', Number(event.target.value))}>
                  {DECIDE_CHOICES.map((minutes) => <option key={minutes} value={minutes}>{waitText(minutes)}</option>)}
                </Select>}
              </Field>
            </div>
            <Notice tone="info" layout="box">
              <p>
                The winner is chosen by {metricText(draft.metric)} {waitText(draft.decide_after_minutes)} after the sample sends, then it goes to the other {100 - draft.sample_pct}%.
                If the two are within 1 point, A wins. You can also pick the winner yourself on the campaign's Performance tab. A test send gets both subjects.
              </p>
            </Notice>
          </>
        )}
        {other && <ErrorState title="The subject line test was not saved" error={other} />}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={buttonPrimary} disabled={!dirty || save.isPending || (draft.enabled && !draft.subject_b.trim())} onClick={() => save.mutate()}>
            {save.isPending && <Spinner size="sm" tone="onBrand" />}Save Subject Test
          </button>
          {save.isSuccess && !dirty && <span role="status" className="text-sm text-success-text">Saved</span>}
          {dirty && <span className="text-helper text-ink-800">Not saved yet.</span>}
        </div>
      </div>
    </Panel>
  )
}
