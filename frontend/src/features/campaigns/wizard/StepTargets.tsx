/** Step 5: what the campaign should achieve and what it may cost (BRD 15). All of it is optional; results are later shown against it. */
import { useFormContext } from 'react-hook-form'

import { Field, TextArea, TextInput } from '@/components/Form'

import { Panel } from '../parts'
import type { CampaignFormValues } from '../schema'

export function StepTargets() {
  const { register, watch, formState: { errors } } = useFormContext<CampaignFormValues>()
  const targets = watch('targets')
  const texts = ['SMS', 'MMS'].includes(watch('channel'))
  const issues = errors.targets

  const cost = Number(targets.planned_cost || 0) + Number(targets.planned_offer_cost || 0)
  const revenue = Number(targets.target_revenue || 0)
  const money = (value: number) => value.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <Panel title="Targets" description="Leave a box empty when there is no target for it.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Revenue (USD)" error={issues?.target_revenue?.message}>{(ids) => <TextInput {...ids} inputMode="decimal" {...register('targets.target_revenue')} />}</Field>
            <Field label="Conversions" error={issues?.target_conversions?.message}>{(ids) => <TextInput {...ids} inputMode="numeric" {...register('targets.target_conversions')} />}</Field>
            {!texts && <Field label="Opens" error={issues?.target_opens?.message}>{(ids) => <TextInput {...ids} inputMode="numeric" {...register('targets.target_opens')} />}</Field>}
            <Field label="Clicks" error={issues?.target_clicks?.message}>{(ids) => <TextInput {...ids} inputMode="numeric" {...register('targets.target_clicks')} />}</Field>
            <Field label="Offer redemptions" error={issues?.target_redemptions?.message}>{(ids) => <TextInput {...ids} inputMode="numeric" {...register('targets.target_redemptions')} />}</Field>
          </div>
        </Panel>
        <Panel title="Economics">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Planned campaign cost (USD)" error={issues?.planned_cost?.message} hint="Creative, sending and agency costs.">{(ids) => <TextInput {...ids} inputMode="decimal" {...register('targets.planned_cost')} />}</Field>
            <Field label="Planned offer cost (USD)" error={issues?.planned_offer_cost?.message} hint="Discounts and rewards you expect to give away.">{(ids) => <TextInput {...ids} inputMode="decimal" {...register('targets.planned_offer_cost')} />}</Field>
            <div className="sm:col-span-2">
              <Field label="Notes" error={issues?.notes?.message}>{(ids) => <TextArea {...ids} rows={3} {...register('targets.notes')} />}</Field>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="The plan in one line" className="self-start">
        {cost === 0 && revenue === 0 ? (
          <p className="text-sm text-ink-500">Enter a revenue target and the planned costs to see the return this campaign is planned for.</p>
        ) : (
          <dl className="divide-y divide-line-subtle text-sm">
            <div className="flex justify-between gap-3 py-1.5"><dt className="text-ink-700">Target revenue</dt><dd className="cep-num text-ink-900">{money(revenue)}</dd></div>
            <div className="flex justify-between gap-3 py-1.5"><dt className="text-ink-700">Planned cost, in all</dt><dd className="cep-num text-ink-900">{money(cost)}</dd></div>
            <div className="flex justify-between gap-3 py-1.5 font-semibold"><dt className="text-ink-900">Planned return</dt><dd className="cep-num text-ink-900">{cost > 0 ? `${(revenue / cost).toFixed(1)} : 1` : '—'}</dd></div>
          </dl>
        )}
      </Panel>
    </div>
  )
}
