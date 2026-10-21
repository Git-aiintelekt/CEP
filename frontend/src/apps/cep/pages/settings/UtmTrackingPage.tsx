/**
 * Settings → UTM Tracking: whether the links of email and text campaigns carry UTM tags, the value of each parameter (fixed
 * text or a campaign field), the sites whose links are tagged, and what happens to a link that already has tags. A live
 * example shows what one link goes out as. The campaign's Content step lists its own links (LinkTrackingCard).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { buttonPrimary, buttonSecondary, Select, TextInput } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { Switch } from '@/components/Switch'
import { useToast } from '@/components/Toast'
import { api, ApiError } from '@/lib/api'
import type { UtmRule, UtmSettings } from '@/lib/types'

import { exampleValues, GA4_PARAMS, PARAM_LABEL, UTM_KEY } from './utm'

type Draft = Pick<UtmSettings, 'email' | 'sms' | 'params' | 'domains' | 'keep_existing'>

const RECOMMENDED: Record<string, UtmRule> = {
  utm_source: { kind: 'text', value: 'c360' }, utm_campaign: { kind: 'field', value: 'campaign_name' }, utm_id: { kind: 'field', value: 'campaign_code' },
  utm_content: { kind: 'field', value: 'link_label_variant' }, utm_term: { kind: 'none', value: '' }, utm_source_platform: { kind: 'text', value: 'c360' },
  utm_marketing_tactic: { kind: 'field', value: 'campaign_category' },
}

function ParamName({ name }: { name: string }) {
  return (
    <div>
      <p className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-ink-900">{name}
        {GA4_PARAMS.has(name) && <span className="inline-flex h-[18px] items-center rounded-sm bg-plum-100 px-1.5 font-sans text-[11px] font-semibold text-plum-700">GA4</span>}</p>
      <p className="text-xs text-ink-800">{PARAM_LABEL[name]}</p>
    </div>
  )
}

const draftOf = (data: UtmSettings): Draft => ({ email: data.email, sms: data.sms, params: data.params, domains: data.domains, keep_existing: data.keep_existing })

export function UtmTrackingPage() {
  const settings = useQuery({ queryKey: UTM_KEY, queryFn: ({ signal }) => api.get<UtmSettings>('/workspace/utm/', undefined, signal) })
  if (settings.isError) return <ErrorState title="UTM tracking could not be loaded" error={settings.error} onRetry={() => void settings.refetch()} />
  if (settings.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  return <UtmForm data={settings.data} />
}

function UtmForm({ data }: { data: UtmSettings }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>(() => draftOf(data))
  const [domain, setDomain] = useState('')
  const save = useMutation({
    mutationFn: (body: Draft) => api.put<UtmSettings>('/workspace/utm/', body),
    onSuccess: (next) => {
      queryClient.setQueryData(UTM_KEY, next)
      setDraft(draftOf(next))
      toast.success('UTM tracking saved', next.email || next.sms ? 'Campaigns published from now on carry the tags.' : 'Links go out as written.')
    },
  })
  const errors = save.error instanceof ApiError ? save.error.fieldErrors : {}
  const on = draft.email || draft.sms
  const setRule = (name: string, rule: UtmRule) => setDraft({ ...draft, params: { ...draft.params, [name]: rule } })
  const addDomain = () => {
    const value = domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^\./, '')
    if (value && !draft.domains.includes(value)) setDraft({ ...draft, domains: [...draft.domains, value].sort() })
    setDomain('')
  }
  const example = exampleValues(draft.params, 'EMAIL')
  const exampleUrl = `https://${draft.domains[0] ?? 'shop.example.com'}/fall?` + Object.entries(example).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join('&')
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate(draft) }

  return (
    <form className="space-y-5" onSubmit={submit} noValidate>
      <div className="flex flex-wrap items-start justify-between gap-3 md:flex-nowrap">
        <div className="min-w-0">
          <h2 className="font-display text-section-title font-semibold text-ink-900">UTM Tracking</h2>
          <p className="mt-0.5 max-w-3xl text-sm text-ink-800">Tags the links in your campaigns, so Google Analytics and other tools credit each visit to the right campaign. Applies to campaigns sent from now on.</p>
        </div>
        <button type="submit" className={buttonPrimary} disabled={save.isPending}>{save.isPending ? 'Saving' : 'Save'}</button>
      </div>
      {!data.ready && <p className="rounded-lg border border-line px-4 py-3 text-sm text-ink-800">Link tagging is not switched on here yet. These settings are kept and take effect once it is.</p>}

      <section aria-label="Channels" className="grid gap-4 rounded-lg border border-line bg-surface p-5 md:grid-cols-2">
        <div className="flex items-start gap-3">
          <Switch checked={draft.email} onChange={(next) => setDraft({ ...draft, email: next })} labelledBy="utm-email" describedBy="utm-email-help" />
          <div><p id="utm-email" className="text-sm font-semibold text-ink-900">Email Campaigns</p><p id="utm-email-help" className="text-sm text-ink-800">Links to your sites get the tags below.</p></div>
        </div>
        <div className="flex items-start gap-3">
          <Switch checked={draft.sms} onChange={(next) => setDraft({ ...draft, sms: next })} labelledBy="utm-sms" describedBy="utm-sms-help" />
          <div><p id="utm-sms" className="text-sm font-semibold text-ink-900">Text Campaigns</p><p id="utm-sms-help" className="text-sm text-ink-800">Links become short links that open the tagged page and count clicks.</p></div>
        </div>
      </section>

      {!on ? (
        <p className="rounded-lg bg-callout-bg px-4 py-3 text-sm text-callout-text">Switch a channel on to choose the values. The recommended set works with Google Analytics 4 as it is: its Email and SMS channels pick up utm_medium=email and utm_medium=sms.</p>
      ) : (
        <>
          <section aria-labelledby="utm-params" className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-subtle px-5 py-4">
              <div>
                <h3 id="utm-params" className="font-display text-card-heading font-semibold text-ink-900">Parameters</h3>
                <p className="text-sm text-ink-800">Fixed text, or a campaign field. Values are sent lowercase with dashes: “Fall Launch” goes out as fall-launch.</p>
              </div>
              <button type="button" className="text-sm font-medium text-brand-800 hover:underline" onClick={() => setDraft({ ...draft, params: { ...RECOMMENDED } })}>Reset to Recommended</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Parameters</caption>
                <thead><tr className="border-b border-line bg-surface-subtle text-left">
                  <th scope="col" className="px-5 py-2.5 font-semibold text-ink-900">Parameter</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold text-ink-900">Value</th>
                  <th scope="col" className="px-5 py-2.5 font-semibold text-ink-900">Sent As (example: Fall Launch, hero button, variant B)</th>
                </tr></thead>
                <tbody>
                  {data.parameters.map((name) => {
                    const fixed = data.by_channel[name]
                    const rule = draft.params[name] ?? { kind: 'none', value: '' }
                    const error = errors[`params.${name}`]
                    return (
                      <tr key={name} className="border-b border-line-subtle last:border-b-0 align-top">
                        <td className="px-5 py-3"><ParamName name={name} /></td>
                        <td className="px-3 py-3">
                          {fixed ? <p className="pt-1.5 text-sm text-ink-800">{fixed.EMAIL} or {fixed.SMS}, by the campaign’s channel</p> : (
                            <div className="flex flex-wrap gap-2">
                              <Select aria-label={`${name} value`} className="w-56" controlSize="sm" value={rule.kind === 'field' ? rule.value : rule.kind}
                                onChange={(event) => {
                                  const next = event.target.value
                                  setRule(name, next === 'text' ? { kind: 'text', value: rule.kind === 'text' ? rule.value : '' } : next === 'none' ? { kind: 'none', value: '' } : { kind: 'field', value: next })
                                }}>
                                <option value="text">Fixed Text</option>
                                {data.fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                                {name !== 'utm_source' && <option value="none">Not Sent</option>}
                              </Select>
                              {rule.kind === 'text' && <div className="w-44"><TextInput aria-label={`${name} text`} className="font-mono" controlSize="sm" value={rule.value} invalid={Boolean(error)}
                                onChange={(event) => setRule(name, { kind: 'text', value: event.target.value })} /></div>}
                            </div>
                          )}
                          {error && <p role="alert" className="mt-1 text-xs text-danger-text">{error}</p>}
                        </td>
                        <td className="px-5 py-3"><code className="font-mono text-xs text-ink-900">{fixed ? fixed.EMAIL : rule.kind === 'none' ? '—' : example[name] || '—'}</code></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section aria-labelledby="utm-sites" className="rounded-lg border border-line bg-surface p-5">
              <h3 id="utm-sites" className="font-display text-card-heading font-semibold text-ink-900">Your Sites</h3>
              <p className="text-sm text-ink-800">Only links to these domains and their subdomains are tagged.</p>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Your sites">
                {draft.domains.map((item) => (
                  <li key={item} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line pl-2.5 pr-1 text-sm text-ink-900">{item}
                    <button type="button" aria-label={`Remove ${item}`} className="rounded-sm p-0.5 text-ink-800 hover:bg-fill-subtle" onClick={() => setDraft({ ...draft, domains: draft.domains.filter((d) => d !== item) })}><X size={14} strokeWidth={1.5} aria-hidden /></button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <TextInput aria-label="Add a domain" placeholder="Add a domain, e.g. shop.northwindapparel.com" value={domain} onChange={(event) => setDomain(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addDomain() } }} invalid={Boolean(errors.domains)} />
                <button type="button" className={buttonSecondary} onClick={addDomain} disabled={!domain.trim()}>Add</button>
              </div>
              {errors.domains && <p role="alert" className="mt-1 text-xs text-danger-text">{errors.domains}</p>}
              <p className="mt-3 text-xs text-ink-800">Never tagged: other sites, mailto: and tel: links, and the unsubscribe and preference links.</p>
            </section>
            <section aria-labelledby="utm-existing" className="rounded-lg border border-line bg-surface p-5">
              <h3 id="utm-existing" className="font-display text-card-heading font-semibold text-ink-900">Links That Already Have Tags</h3>
              <fieldset className="mt-3 space-y-3">
                <legend className="sr-only">Links That Already Have Tags</legend>
                <label className="flex items-start gap-2 text-sm text-ink-900"><input type="radio" name="keep" className="mt-1" checked={draft.keep_existing} onChange={() => setDraft({ ...draft, keep_existing: true })} />
                  <span>Keep their tags<span className="block text-xs text-ink-800">Recommended. A link someone tagged by hand stays as it is; missing parameters are added.</span></span></label>
                <label className="flex items-start gap-2 text-sm text-ink-900"><input type="radio" name="keep" className="mt-1" checked={!draft.keep_existing} onChange={() => setDraft({ ...draft, keep_existing: false })} />
                  <span>Replace them with these<span className="block text-xs text-ink-800">Every link carries this workspace’s values.</span></span></label>
              </fieldset>
            </section>
          </div>

          <section aria-label="Example" className="rounded-lg border border-line-subtle bg-surface-subtle px-4 py-3">
            <p className="text-xs text-ink-800">Example: the hero button of “Fall Launch: New Arrivals”, variant B</p>
            <p className="mt-1 font-mono text-xs text-ink-900 [overflow-wrap:anywhere]">{exampleUrl}</p>
          </section>
        </>
      )}
    </form>
  )
}

