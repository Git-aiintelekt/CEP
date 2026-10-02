/**
 * Targets: what the campaign should achieve (engagement targets, each shown as a share of the estimated recipients)
 * and what it may cost (economics), with the plan summed up on the side. All of it is optional; results are later
 * shown against it (BRD 15).
 */
import { useState } from 'react'
import { Controller, useFormContext, type FieldPath } from 'react-hook-form'

import { Field, TextArea } from '@/components/Form'
import { InputGroup } from '@/components/InputGroup'
import { useFieldRules } from '@/lib/fieldRules'
import { formatMoney, formatNumber } from '@/lib/format'

import { useAudienceEstimate } from '../audienceNumbers'
import { DetailCard, Fact } from '../parts'
import type { CampaignFormValues } from '../schema'

type TargetKey = keyof CampaignFormValues['targets']
const COST_CHIPS = [500, 1000, 2500]

const toNumber = (value: string) => (value.trim() === '' || Number.isNaN(Number(value)) ? null : Number(value))

/** thousands separators while the box isn't being typed in; the form keeps the plain number */
function shown(value: string, money: boolean): string {
  const number = toNumber(value)
  if (number === null) return value
  return number.toLocaleString(undefined, { maximumFractionDigits: money ? 2 : 0, minimumFractionDigits: money && !Number.isInteger(number) ? 2 : 0 })
}

function AmountInput({ name, money = false, ids }: { name: FieldPath<CampaignFormValues>; money?: boolean; ids: { id: string; describedBy: string | undefined; invalid: boolean } }) {
  const { control } = useFormContext<CampaignFormValues>()
  const [typing, setTyping] = useState(false)
  return (
    <Controller control={control} name={name} render={({ field }) => {
      const value = String(field.value ?? '')
      return (
        <InputGroup id={ids.id} describedBy={ids.describedBy} invalid={ids.invalid} controlSize="md" start={money ? <span className="text-sm">$</span> : undefined}
          inputMode={money ? 'decimal' : 'numeric'} className="[&_input]:text-right [&_input]:tabular-nums" name={field.name} ref={field.ref}
          value={typing ? value : shown(value, money)}
          onFocus={() => setTyping(true)}
          onBlur={() => { setTyping(false); field.onBlur() }}
          onChange={(event) => field.onChange(event.target.value.replace(/,/g, ''))} />
      )
    }} />
  )
}

function ShareLine({ value, recipients, receipt }: { value: string; recipients: number | null; receipt: boolean }) {
  if (receipt) return null
  const number = toNumber(value)
  const text = recipients === null ? 'Add contact lists to see the share'
    : number === null || number === 0 ? 'Leave blank if you’re not tracking this'
    : `≈ ${((number / Math.max(1, recipients)) * 100).toFixed(1)}% of ${formatNumber(recipients)} estimated recipients`
  return <p className="cep-num mt-1.5 text-helper text-ink-800" data-share>{text}</p>
}

/** $500 · $1,000 · $2,500 · Custom, and Clear: a chip fills the amount; Custom (or any other amount) shows the box */
function CostPicker({ name, label, hint, error }: { name: 'planned_cost' | 'planned_offer_cost'; label: string; hint: string; error?: string }) {
  const { watch, setValue } = useFormContext<CampaignFormValues>()
  const value = watch(`targets.${name}`)
  const number = toNumber(value)
  const [customAsked, setCustomAsked] = useState(false)
  const chip = number !== null && COST_CHIPS.includes(number) && !customAsked ? number : null
  const custom = customAsked || (value.trim() !== '' && chip === null)
  const set = (next: string) => setValue(`targets.${name}`, next, { shouldDirty: true, shouldValidate: true })
  const chipClass = (on: boolean) => `h-8 rounded-control-md border px-3 text-helper font-semibold transition-colors duration-fast ease-standard ${on ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-800 hover:bg-surface-subtle'}`

  return (
    <div data-cost={name}>
      <Field label={label} strong hint={hint} error={error}>
        {(ids) => (
          <div className="flex flex-col gap-2">
            <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-2">
              {COST_CHIPS.map((amount) => (
                <button key={amount} type="button" role="radio" aria-checked={chip === amount} className={chipClass(chip === amount)}
                  onClick={() => { setCustomAsked(false); set(String(amount)) }}>{formatMoney(amount, { whole: true })}</button>
              ))}
              <button type="button" role="radio" aria-checked={custom} className={chipClass(custom)} onClick={() => setCustomAsked(true)}>Custom</button>
              {value.trim() !== '' || customAsked ? (
                <button type="button" className="ml-1 text-helper font-semibold text-brand-800 hover:underline" onClick={() => { setCustomAsked(false); set('') }}>Clear</button>
              ) : null}
            </div>
            {custom && <div className="sm:w-1/2 sm:pr-3"><AmountInput name={`targets.${name}`} money ids={ids} /></div>}
          </div>
        )}
      </Field>
    </div>
  )
}

function PlanCard({ targets }: { targets: CampaignFormValues['targets'] }) {
  const revenue = toNumber(targets.target_revenue) ?? 0
  const spend = (toNumber(targets.planned_cost) ?? 0) + (toNumber(targets.planned_offer_cost) ?? 0)
  const conversions = toNumber(targets.target_conversions) ?? 0
  const perConversion = spend > 0 && conversions > 0 ? spend / conversions : null
  const money = (value: number) => formatMoney(value, { whole: true })

  return (
    <DetailCard title="Plan at a Glance">
      {revenue === 0 && spend === 0 && conversions === 0 ? (
        <p className="text-sm text-ink-800">Enter a revenue target and the planned costs to see the return this campaign is planned for.</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1" data-testid="cost-per-conversion">
            <span className="text-helper font-semibold text-ink-800">Projected Cost per Conversion</span>
            <span className="cep-num font-display text-2xl font-semibold text-ink-900">{perConversion === null ? '—' : formatMoney(perConversion)}</span>
            <span className="text-helper text-ink-800">{perConversion === null ? 'Add planned costs and a conversions target' : 'Planning estimate, not a guaranteed outcome'}</span>
          </div>
          <dl className="flex flex-col gap-4 border-t border-line-subtle pt-4">
            <Fact label="Target Revenue">{revenue > 0 ? money(revenue) : '—'}</Fact>
            <Fact label="Total Planned Spend" secondary="Campaign cost and offer cost">{spend > 0 ? money(spend) : '—'}</Fact>
            <Fact label="Planned Return">{spend > 0 && revenue > 0 ? `${(revenue / spend).toFixed(1)} : 1` : '—'}</Fact>
          </dl>
        </div>
      )}
    </DetailCard>
  )
}

export function StepTargets() {
  const { register, watch, formState: { errors } } = useFormContext<CampaignFormValues>()
  const targets = watch('targets')
  const channel = watch('channel')
  const texts = ['SMS', 'MMS'].includes(channel)
  const receipt = watch('campaign_type') === 'E_RECEIPT'
  const estimate = useAudienceEstimate(receipt ? [] : watch('contact_lists'), watch('excluded_lists'), channel, watch('solicitation_type'))
  const recipients = estimate.data ? estimate.data.estimated_recipients : null
  const issues = errors.targets
  const rule = useFieldRules('campaign')
  const NOTES_MAX = rule('targets.notes')?.max ?? 1000

  const target = (key: TargetKey, label: string) => (
    <div key={key}>
      <Field label={label} strong error={issues?.[key]?.message}>
        {(ids) => <AmountInput name={`targets.${key}`} ids={ids} />}
      </Field>
      <ShareLine value={targets[key]} recipients={recipients} receipt={receipt} />
    </div>
  )

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-6">
        <DetailCard title="Engagement Targets" description="All optional. Leave a box empty when there's no target for it.">
          <div className="grid gap-6 sm:grid-cols-2">
            {!texts && target('target_opens', 'Opens')}
            {target('target_clicks', 'Clicks')}
            {target('target_conversions', 'Conversions')}
            {target('target_redemptions', 'Offer Redemptions')}
          </div>
        </DetailCard>

        <DetailCard title="Economics">
          <div className="flex flex-col gap-6">
            <div className="sm:w-1/2 sm:pr-3">
              <Field label="Target Revenue" strong error={issues?.target_revenue?.message}>{(ids) => <AmountInput name="targets.target_revenue" money ids={ids} />}</Field>
            </div>
            <CostPicker name="planned_cost" label="Planned Campaign Cost" hint="Creative, sending and agency costs." error={issues?.planned_cost?.message} />
            <CostPicker name="planned_offer_cost" label="Planned Offer Cost" hint="Discounts and rewards you expect to give away." error={issues?.planned_offer_cost?.message} />
            <Field label="Notes" strong error={issues?.notes?.message} limit={{ used: (targets.notes ?? '').length, max: rule('targets.notes')?.max ?? NOTES_MAX }}>
              {(ids) => <TextArea {...ids} rows={3} maxLength={rule('targets.notes')?.max ?? NOTES_MAX} {...register('targets.notes')} />}
            </Field>
          </div>
        </DetailCard>
      </div>

      <div className="lg:sticky lg:top-44 xl:top-36" data-plan-card>
        <PlanCard targets={targets} />
      </div>
    </div>
  )
}
