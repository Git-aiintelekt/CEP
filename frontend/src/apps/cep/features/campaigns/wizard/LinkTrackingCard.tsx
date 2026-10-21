/** The Content step's Link Tracking: every link of the chosen template, its label (utm_content), whether it is tagged and the
 * address it opens; this campaign's own campaign name and tactic as sent, and a switch to send its links as written. Saved on
 * their own (PUT /campaigns/<id>/link-tracking/), so the campaign's own save is not touched. A text's links show their clicks. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { Link } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { DataTable, type Column } from '@/components/DataTable'
import { Field, Select, TextInput } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { Switch } from '@/components/Switch'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { Campaign, CampaignLinkTracking, LinkTrackingChoices, LinkVerdict, UtmPreview } from '@/lib/types'

import { slug } from '@/apps/cep/pages/settings/utm'

import { Panel } from '../parts'
import type { CampaignFormValues } from '../schema'

const VERDICT: Record<LinkVerdict, { status: string; label: string }> = {
  TAGGED: { status: 'PASSES', label: 'Tagged' },
  OWN_TAGS: { status: 'PAUSED', label: 'Own Tags Kept' },
  NOT_YOUR_SITE: { status: 'NEUTRAL', label: 'Not Your Site' },
  NEVER: { status: 'NEUTRAL', label: 'Never Tagged' },
}
const TACTICS = ['promotional', 'transactional', 'nurture', 'lifecycle', 'retention', 'win-back', 'other']

type Row = UtmPreview['links'][number]

/** keyed by the saved label, so a save (or another person's) starts it afresh */
function LabelInput({ row, onSave }: { row: Row; onSave: (value: string) => void }) {
  const [value, setValue] = useState(row.label)
  return (
    <TextInput aria-label={`Label of ${row.text}`} className="font-mono" controlSize="sm" value={value}
      onChange={(event) => setValue(event.target.value)} onBlur={() => { const next = slug(value) || row.default_label; setValue(next); if (next !== row.label) onSave(next) }} />
  )
}

function CampaignNameInput({ ids, placeholder, saved, onSave }: { ids: { id: string; describedBy?: string; invalid?: boolean }; placeholder: string; saved: string; onSave: (value: string) => void }) {
  const [value, setValue] = useState(saved)
  return (
    <TextInput {...ids} className="font-mono" placeholder={placeholder} value={value} onChange={(event) => setValue(event.target.value)}
      onBlur={() => { const next = slug(value); setValue(next); if (next !== saved) onSave(next) }} />
  )
}

export function LinkTrackingCard({ campaign }: { campaign: Campaign | null }) {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const { watch } = useFormContext<CampaignFormValues>()
  const [template, channel, name, code, campaignType, solicitation] = watch(['template', 'channel', 'name', 'code', 'campaign_type', 'solicitation_type'])
  const key = ['campaigns', campaign?.id, 'link-tracking']
  const choices = useQuery({ queryKey: key, queryFn: ({ signal }) => api.get<CampaignLinkTracking>(`/campaigns/${campaign!.id}/link-tracking/`, undefined, signal), enabled: Boolean(campaign) })
  const tracking: LinkTrackingChoices = { enabled: choices.data?.enabled ?? true, overrides: choices.data?.overrides ?? {}, labels: choices.data?.labels ?? {} }
  const preview = useQuery({
    queryKey: ['utm', 'preview', template, channel, name, code, campaignType, solicitation, tracking],
    queryFn: () => api.post<UtmPreview>('/utm/preview/', { template_id: template, channel, name, code, campaign_type: campaignType, solicitation_type: solicitation, tracking }),
    enabled: Boolean(campaign && template && choices.data),
    placeholderData: (previous) => previous,
  })
  const save = useMutation({
    mutationFn: (next: LinkTrackingChoices) => api.put<CampaignLinkTracking>(`/campaigns/${campaign!.id}/link-tracking/`, next),
    onSuccess: (next) => queryClient.setQueryData(key, next),
  })

  if (!template) return null
  if (!campaign) return <Panel title="Link Tracking"><p className="text-sm text-ink-800">Link tracking appears once the draft is saved.</p></Panel>
  if (choices.isError || preview.isError) return <ErrorState title="Link tracking could not be loaded" error={choices.error ?? preview.error} onRetry={() => { void choices.refetch(); void preview.refetch() }} />
  if (!preview.data) return <Panel title="Link Tracking"><p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Finding the links</p></Panel>

  const data = preview.data
  const texts = data.channel === 'SMS'
  const settingsLink = can('provider.edit') ? <Link to="/settings/utm-tracking" className="font-medium text-brand-800 hover:underline">Settings, UTM Tracking</Link> : 'Settings, UTM Tracking'
  if (!data.ready || !data.workspace_on) {
    return (
      <Panel title="Link Tracking">
        <p className="text-sm text-ink-800">{!data.ready ? 'Link tagging is not switched on here yet; links go out as written.'
          : <>UTM tracking is off for {texts ? 'text' : 'email'} campaigns, so links go out as written. An administrator switches it on under {settingsLink}.</>}</p>
      </Panel>
    )
  }

  const tagged = data.links.filter((row) => row.verdict === 'TAGGED' || row.verdict === 'OWN_TAGS')
  const clicksFor = (row: Row) => (choices.data?.clicks ?? []).filter((item) => item.label === row.label).reduce((sum, item) => sum + item.clicks, 0)
  const update = (next: Partial<LinkTrackingChoices>) => save.mutate({ ...tracking, ...next })
  const setLabel = (row: Row, value: string) => {
    const labels = { ...tracking.labels }
    if (value === row.default_label) delete labels[row.key]
    else labels[row.key] = value
    update({ labels })
  }
  const columns: Column<Row>[] = [
    { key: 'link', header: 'Link', render: (row) => <div className="min-w-0 max-w-[18rem]"><p className="truncate text-ink-900">{row.text}</p><p className="truncate text-xs text-ink-800" title={row.url}>{row.url}</p></div> },
    { key: 'label', header: 'Label (utm_content)', render: (row) => row.verdict === 'TAGGED' || row.verdict === 'OWN_TAGS'
      ? <div className="w-44"><LabelInput key={row.label} row={row} onSave={(value) => setLabel(row, value)} /></div> : <span className="text-ink-800">—</span> },
    { key: 'verdict', header: 'Tagging', render: (row) => <StatusBadge status={VERDICT[row.verdict].status} label={VERDICT[row.verdict].label} /> },
    texts
      ? { key: 'sent', header: 'Sent As', render: (row) => row.short ? <div><p className="font-mono text-xs text-ink-900">Short link</p><p className="cep-num text-xs text-ink-800">{formatNumber(clicksFor(row))} click{clicksFor(row) === 1 ? '' : 's'}</p></div> : <span className="text-xs text-ink-800">As written</span> }
      : { key: 'opens', header: 'Opens', render: (row) => <p className="max-w-[16rem] truncate font-mono text-xs text-ink-800 2xl:max-w-md" title={row.opens}>{row.opens}</p> },
  ]

  return (
    <Panel title="Link Tracking"
      description={!tracking.enabled ? 'This campaign’s links go out as written.'
        : data.links.length === 0 ? 'This message has no links.'
        : `${tagged.length} of ${data.links.length} link${data.links.length === 1 ? '' : 's'} carry UTM tags.${texts ? ' Each becomes a short link that opens the tagged page and counts clicks.' : ' Change a link’s label to tell its clicks apart in Google Analytics.'}`}
      actions={<div className="flex items-center gap-2"><Switch checked={tracking.enabled} disabled={save.isPending} onChange={(enabled) => update({ enabled })} labelledBy="tag-links" /><span id="tag-links" className="text-sm font-medium text-ink-900">Tag Links in This Campaign</span></div>}>
      {tracking.enabled && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Campaign (utm_campaign)" hint={`From the campaign name: ${data.defaults.utm_campaign || '—'}. Type another for this campaign only.`}>
              {(ids) => <CampaignNameInput key={tracking.overrides.utm_campaign ?? ''} ids={ids} placeholder={data.defaults.utm_campaign} saved={tracking.overrides.utm_campaign ?? ''}
                onSave={(next) => update({ overrides: { ...tracking.overrides, utm_campaign: next || undefined } })} />}
            </Field>
            <Field label="Tactic (utm_marketing_tactic)" hint={`From the campaign type: ${data.defaults.utm_marketing_tactic || '—'}.`}>
              {(ids) => (
                <Select {...ids} value={tracking.overrides.utm_marketing_tactic ?? ''} onChange={(event) => update({ overrides: { ...tracking.overrides, utm_marketing_tactic: event.target.value || undefined } })}>
                  <option value="">From the Campaign Type</option>
                  {TACTICS.map((tactic) => <option key={tactic} value={tactic}>{tactic}</option>)}
                </Select>
              )}
            </Field>
          </div>
          {data.links.length > 0 && <DataTable columns={columns} rows={data.links} rowKey={(row) => row.key} caption="Links" framed density="compact" />}
        </div>
      )}
    </Panel>
  )
}
