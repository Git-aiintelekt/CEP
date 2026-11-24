/**
 * Settings → Engagement → Message Costs (docs/mockups/sms-mms-costs.html): what texts cost this workspace. Prices are read-only,
 * set by the platform team; the workspace administrator sets the approval limit, the monthly budget, and for WhatsApp the
 * countries and the home country. Before the platform team adds a price, the page says so and the limits are hidden.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/Button'
import { Checkbox } from '@/components/Checkbox'
import { Field, Select, TextInput } from '@/components/Form'
import { ProgressBar } from '@/components/ProgressBar'
import { SaveTick } from '@/components/SaveTick'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tag } from '@/components/StatusBadge'
import { ApiError, api } from '@/lib/api'
import { formatDate, formatNumber } from '@/lib/format'
import type { MessageCosts, MessageCostSettings, OverBudget, TextPrice, WhatsAppPrices } from '@/lib/types'

import { costMoney, unitMoney } from '../../features/costs/money'

const KEY = ['workspace', 'message-costs']
const OVER_BUDGET: [OverBudget, string, string][] = [
  ['WARN', 'Warn Only', 'The campaign is published; admins are warned.'],
  ['APPROVAL', 'Needs Approval', 'An approver signs it off before Publish to Production.'],
  ['BLOCK', 'Block Publishing', 'Publish to Production waits for next month or a higher budget.'],
]
const FEES_WORDS = { PASS_ON: 'passed on at cost', INCLUDED: 'included in the price', ABSORBED: 'not charged' } as const

function Card({ title, description, actions, children }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line-subtle px-5 py-4">
        <div>
          <h3 className="font-display text-card-heading font-semibold text-ink-900">{title}</h3>
          {description && <p className="mt-0.5 text-helper text-ink-800">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

function feeText(price: TextPrice, currency: string | null) {
  if (price.fees !== 'PASS_ON' || (!Number(price.fee_part) && !Number(price.fee_mms))) return price.fees === 'INCLUDED' ? 'Included' : '—'
  return `${unitMoney(price.fee_part, currency)} a part · ${unitMoney(price.fee_mms, currency)} an MMS`
}

function PricesCard({ data }: { data: MessageCosts }) {
  const currency = data.currency
  const change = data.texts.find((row) => row.next)
  return (
    <Card title="Prices" description="Set by the platform team. Ask them to change a price." actions={currency ? <Tag>{currency}</Tag> : undefined}>
      {data.texts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="cep-num w-full text-sm" aria-label="Text prices">
            <thead>
              <tr className="text-left text-helper text-ink-800">
                <th className="pb-2 font-semibold">Sender</th><th className="pb-2 text-right font-semibold">SMS a Part</th><th className="pb-2 text-right font-semibold">MMS</th><th className="pb-2 text-right font-semibold">Carrier Fees</th>
              </tr>
            </thead>
            <tbody>
              {data.texts.map((row) => (
                <tr key={row.sender_id} className="border-t border-line-subtle">
                  <td className="py-2.5 pr-3">
                    <span className="font-semibold text-ink-900">{row.sender_type}{row.number ? ` ${row.number}` : ''}</span>
                    <span className="block text-helper text-ink-800">{row.sender} · {row.engine}{row.countries.length ? ` · own prices for ${row.countries.map((country) => country.name).join(', ')}` : ''}</span>
                  </td>
                  <td className="py-2.5 text-right">{row.current ? unitMoney(row.current.sms, currency) : '—'}</td>
                  <td className="py-2.5 text-right">{row.current?.mms ? unitMoney(row.current.mms, currency) : '—'}</td>
                  <td className="py-2.5 text-right text-helper">{row.current ? feeText(row.current, currency) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {change?.next && (
        <p className="mt-3 rounded-sm border border-line-subtle bg-surface-subtle px-3 py-2 text-helper text-ink-800">
          From {formatDate(change.next.effective_from)}, {change.sender_type} SMS is {unitMoney(change.next.sms, currency)} a part{change.next.mms ? ` and MMS ${unitMoney(change.next.mms, currency)}` : ''}. Campaigns sent before then keep today’s price.
        </p>
      )}
      {data.texts.length > 0 && data.texts[0].current && <p className="mt-3 text-helper text-ink-800">Carrier fees are {FEES_WORDS[data.texts[0].current.fees]}. An SMS part is 160 characters, 153 each when longer; with an emoji or other special character, 70 and 67. An MMS is one price whatever its length.</p>}
    </Card>
  )
}

function MonthCard({ data }: { data: MessageCosts }) {
  const month = data.month
  if (!month) return null
  const currency = data.currency
  const budget = data.settings.monthly_budget ? Number(data.settings.monthly_budget) : null
  const used = Number(month.total)
  const percent = budget ? Math.round((used / budget) * 100) : null
  const warn = percent !== null && percent >= data.settings.warn_at
  const label = new Date(`${month.month}T00:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  return (
    <Card title="This Month" description={`${label}, every text sent: campaigns, journeys, drips and e-receipts.`}>
      <p className="cep-num font-display text-kpi font-semibold text-ink-900">
        {costMoney(month.total, currency)}{budget !== null && <span className="text-sm font-normal text-ink-800"> of a {costMoney(budget, currency)} budget</span>}
      </p>
      {percent !== null && (
        <div className="mt-3 flex flex-col gap-1.5">
          <ProgressBar value={percent} label="Budget used" />
          <p className={`cep-num text-helper ${warn ? 'font-medium text-warning-text' : 'text-ink-800'}`}>{percent}% used · {month.days_left} day{month.days_left === 1 ? '' : 's'} left · Warn at {data.settings.warn_at}%</p>
        </div>
      )}
      <dl className="cep-num mt-4 grid gap-2 text-sm sm:grid-cols-2">
        {[['Campaigns', month.campaigns], ['Journeys and drips', month.journeys], ['E-receipts by text', month.receipts], ['Scheduled later this month', month.scheduled]].map(([name, value]) => (
          <div key={name} className="flex justify-between gap-3 border-t border-line-subtle pt-2"><dt className="text-ink-800">{name}</dt><dd className="text-ink-900">{costMoney(value, currency)}</dd></div>
        ))}
      </dl>
    </Card>
  )
}

interface LimitsDraft { approval_above: string; monthly_budget: string; warn_at: string; over_budget: OverBudget }

function LimitsCard({ data, onSave, saving, error }: { data: MessageCosts; onSave: (values: Partial<MessageCostSettings> & Record<string, unknown>) => void; saving: boolean; error: unknown }) {
  const settings = data.settings
  const [draft, setDraft] = useState<LimitsDraft | null>(null)
  const currency = data.currency ?? ''
  const fieldErrors = error instanceof ApiError ? error.fieldErrors : {}
  const editing = draft !== null
  const start = () => setDraft({ approval_above: settings.approval_above ?? '', monthly_budget: settings.monthly_budget ?? '', warn_at: String(settings.warn_at), over_budget: settings.over_budget })
  const actions = data.can_edit && !editing ? <Button size="sm" onClick={start}>Edit</Button> : undefined
  return (
    <Card title="Limits" description="Checked when a campaign is published to production. Estimates use the price on the send date." actions={actions}>
      {editing ? (
        <form className="grid gap-5 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); onSave({ ...draft, warn_at: Number(draft.warn_at) }) }}>
          <Field label={`Approval Above (${currency} a campaign)`} hint="A larger estimate needs approval before production publish. Empty: never." error={fieldErrors.approval_above}>
            {(ids) => <TextInput {...ids} inputMode="decimal" placeholder="100.00" value={draft.approval_above} onChange={(event) => setDraft({ ...draft, approval_above: event.target.value })} />}
          </Field>
          <Field label={`Monthly Budget (${currency})`} hint="Every text sent in the month counts. Empty: no budget." error={fieldErrors.monthly_budget}>
            {(ids) => <TextInput {...ids} inputMode="decimal" placeholder="1,000.00" value={draft.monthly_budget} onChange={(event) => setDraft({ ...draft, monthly_budget: event.target.value })} />}
          </Field>
          <Field label="Warn At (% of budget)" hint="Admins see an alert on Home once the month reaches it." error={fieldErrors.warn_at}>
            {(ids) => <TextInput {...ids} inputMode="numeric" value={draft.warn_at} onChange={(event) => setDraft({ ...draft, warn_at: event.target.value })} />}
          </Field>
          <Field label="Over Budget" hint={OVER_BUDGET.find(([code]) => code === draft.over_budget)?.[2] + ' E-receipts and journeys already running are never held.'} error={fieldErrors.over_budget}>
            {(ids) => <Select {...ids} value={draft.over_budget} onChange={(event) => setDraft({ ...draft, over_budget: event.target.value as OverBudget })}>
              {OVER_BUDGET.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </Select>}
          </Field>
          {error && !Object.keys(fieldErrors).length ? <div className="sm:col-span-2"><ErrorState title="The limits were not saved" error={error} /></div> : null}
          <div className="flex gap-3 sm:col-span-2">
            <Button variant="primary" type="submit" disabled={saving}>{saving && <Spinner size="sm" />}Save Limits</Button>
            <Button type="button" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label="Approval Above" note="A larger estimate needs approval before production publish.">{settings.approval_above ? `${costMoney(settings.approval_above, data.currency)} a campaign` : 'Never'}</Fact>
          <Fact label="Monthly Budget" note="Every text sent in the month counts.">{settings.monthly_budget ? costMoney(settings.monthly_budget, data.currency) : 'No budget'}</Fact>
          <Fact label="Warn At" note="An alert on Home for administrators.">{settings.monthly_budget ? `${settings.warn_at}% of budget` : '—'}</Fact>
          <Fact label="Over Budget" note="E-receipts are never held.">{OVER_BUDGET.find(([code]) => code === settings.over_budget)?.[1]}</Fact>
        </dl>
      )}
    </Card>
  )
}

function Fact({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-helper font-semibold text-ink-800">{label}</dt>
      <dd className="cep-num text-card-title text-ink-900">{children}</dd>
      <dd className="text-helper text-ink-800">{note}</dd>
    </div>
  )
}

function WhatsAppCountries({ data, wa, onSave, saving }: { data: MessageCosts; wa: WhatsAppPrices; onSave: (values: Record<string, unknown>) => void; saving: boolean }) {
  const settings = data.settings
  const [draft, setDraft] = useState<{ countries: string[]; home: string } | null>(null)
  const chosen = wa.markets.filter((market) => market.chosen)
  const actions = data.can_edit && !draft ? <Button size="sm" onClick={() => setDraft({ countries: chosen.map((market) => market.market), home: settings.home_country ?? '' })}>Edit</Button> : undefined
  return (
    <Card title="WhatsApp Countries" description="Where this workspace sends WhatsApp. Numbers in other countries are left out of WhatsApp campaigns." actions={actions}>
      {draft ? (
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); onSave({ wa_countries: draft.countries.length === wa.markets.length ? null : draft.countries, home_country: draft.home || null }); setDraft(null) }}>
          <fieldset>
            <legend className="text-label font-medium text-ink-800">Countries, as Meta prices them</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {wa.markets.map((market) => (
                <Checkbox key={market.market} label={`${market.market} (${formatNumber(market.contacts)} contacts)`} checked={draft.countries.includes(market.market)}
                  onChange={(event) => setDraft({ ...draft, countries: event.target.checked ? [...draft.countries, market.market] : draft.countries.filter((name) => name !== market.market) })} />
              ))}
            </div>
          </fieldset>
          <div className="sm:w-1/2">
            <Field label="Home Country" hint="For numbers saved without a country code, and the headline price on templates.">
              {(ids) => <Select {...ids} value={draft.home} onChange={(event) => setDraft({ ...draft, home: event.target.value })}>
                <option value="">Choose a country</option>
                {data.countries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}
              </Select>}
            </Field>
          </div>
          <div className="flex gap-3">
            <Button variant="primary" type="submit" disabled={saving || draft.countries.length === 0}>Save Countries</Button>
            <Button type="button" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap gap-1.5">{chosen.map((market) => <Tag key={market.market}>{market.market}</Tag>)}</p>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-helper font-semibold text-ink-800">Home Country</dt><dd className="text-ink-900">{settings.home_country_name ?? 'Not chosen'}</dd></div>
            <div><dt className="text-helper font-semibold text-ink-800">Billing Currency</dt><dd className="text-ink-900">{wa.currency} · set by the platform team</dd></div>
            <div><dt className="text-helper font-semibold text-ink-800">Free Messages</dt><dd className="text-ink-900">{wa.free_messages === 'FREE' ? 'Free' : `${unitMoney(wa.platform_fee, wa.currency)} platform fee`} · set by the platform team</dd></div>
          </dl>
          {wa.left_out_contacts > 0 && <p className="text-helper text-ink-800">{formatNumber(wa.left_out_contacts)} contacts in other countries are not included.</p>}
        </div>
      )}
    </Card>
  )
}

function WhatsAppPricesCard({ wa }: { wa: WhatsAppPrices }) {
  const [all, setAll] = useState(false)
  const shown = wa.markets.filter((market) => all || market.chosen)
  return (
    <Card title="WhatsApp Prices" description="A delivered message, by the template's category and the recipient's country. Messages that are not delivered are free.">
      <div className="overflow-x-auto">
        <table className="cep-num w-full text-sm" aria-label="WhatsApp prices">
          <thead><tr className="text-left text-helper text-ink-800"><th className="pb-2 font-semibold">Country</th><th className="pb-2 text-right font-semibold">Marketing</th><th className="pb-2 text-right font-semibold">Utility</th><th className="pb-2 text-right font-semibold">Contacts</th></tr></thead>
          <tbody>
            {shown.map((market) => (
              <tr key={market.market} className="border-t border-line-subtle">
                <td className="py-2 pr-3"><span className="text-ink-900">{market.market}</span>{market.countries.length > 1 && <span className="block text-helper text-ink-800">{market.countries.slice(0, 6).join(', ')}{market.countries.length > 6 ? ' …' : ''}</span>}</td>
                <td className="py-2 text-right">{unitMoney(market.marketing, wa.currency)}</td>
                <td className="py-2 text-right">{unitMoney(market.utility, wa.currency)}</td>
                <td className="py-2 text-right">{formatNumber(market.contacts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-helper text-ink-800">
        Free: replies within 24 hours of a customer's message, and Utility templates while that window is open.{' '}
        {wa.markets.length > shown.length || all ? <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={() => setAll(!all)}>{all ? 'Chosen Countries Only' : `All ${wa.markets.length} Countries`}</button> : null}
      </p>
    </Card>
  )
}

export function MessageCostsPage() {
  const queryClient = useQueryClient()
  const costs = useQuery({ queryKey: KEY, queryFn: ({ signal }) => api.get<MessageCosts>('/message-costs/', undefined, signal) })
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) => api.put<MessageCosts>('/message-costs/', values),
    onSuccess: (next) => {
      queryClient.setQueryData(KEY, next)
      void queryClient.invalidateQueries({ queryKey: ['message-prices'] })
    },
  })

  if (costs.isError) return <ErrorState title="The message costs could not be loaded" error={costs.error} onRetry={() => void costs.refetch()} />
  if (costs.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  const data = costs.data

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-section-title font-semibold text-ink-900">Message Costs</h2>
          <p className="mt-0.5 text-sm text-ink-800">What texts cost this workspace, and the limits that apply before a campaign goes out.</p>
        </div>
        <SaveTick mutation={save} />
      </div>

      {!data.set_up ? (
        <EmptyState title="Prices are not set up yet" hint="The platform team sets the price of each text. Until then, nobody here sees costs, and limits cannot be set. Sending is not affected." />
      ) : (
        <>
          {data.texts.length > 0 && <PricesCard data={data} />}
          <MonthCard data={data} />
          <LimitsCard key={JSON.stringify(data.settings)} data={data} onSave={(values) => save.mutate(values)} saving={save.isPending} error={save.error} />
          {data.whatsapp.map((wa) => (
            <div key={wa.engine_id} className="space-y-5">
              <WhatsAppCountries data={data} wa={wa} onSave={(values) => save.mutate(values)} saving={save.isPending} />
              <WhatsAppPricesCard wa={wa} />
            </div>
          ))}
          <Card title="Who Sees Costs" actions={<Link to="/settings/roles" className="text-sm font-semibold text-brand-800 hover:underline">Edit Roles</Link>}>
            <p className="text-sm text-ink-800">
              Roles with the View Message Costs permission: {data.viewers.length ? <strong className="text-ink-900">{data.viewers.join(', ')}</strong> : 'none yet'}.
              {' '}Others see parts and recipients, never money.
            </p>
          </Card>
        </>
      )}
    </div>
  )
}
