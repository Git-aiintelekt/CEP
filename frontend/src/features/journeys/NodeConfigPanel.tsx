/** The per-step panel: Wait's duration, Condition's own real settings (what to check, within how many days), a
 * channel switch + template picker for Email/SMS/MMS, and a coupon/tier/segment picker for the three Action types.
 * Delete is here and on the card's ⋮ menu; × (or Escape) cancels. */
import { useQuery } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'

import { buttonDanger, buttonPrimary, Field, Select, TextInput } from '@/components/Form'
import { SegmentedControl } from '@/components/SegmentedControl'
import { ErrorState, Spinner } from '@/components/States'
import { api } from '@/lib/api'
import type { Audience, Coupon, JourneyNodeType, LoyaltyTier, Page, Template } from '@/lib/types'

import type { EditorNode } from './graphModel'
import { categoryLine, CHECK_OPTIONS, describeStep, WAIT_UNITS, type AddableType } from './nodeDefs'
import { SidePanel } from './SidePanel'

/** The closest existing read pattern for a cached C360 reference (customers.Coupon / customers.LoyaltyTier, the
 * same treatment as customers.Segment, which is exposed to the frontend via GET /contact-lists/audiences/). No such
 * endpoint exists yet for Coupon or LoyaltyTier — see JourneyBuildPage's header note. These calls 404 until one is
 * added; the panel shows that honestly via ErrorState rather than pretending the picker works. */
function useCoupons() {
  return useQuery({ queryKey: ['coupons', 'options'], queryFn: ({ signal }) => api.get<Coupon[]>('/coupons/', undefined, signal), retry: false })
}
function useLoyaltyTiers() {
  return useQuery({ queryKey: ['loyalty-tiers', 'options'], queryFn: ({ signal }) => api.get<LoyaltyTier[]>('/loyalty-tiers/', undefined, signal), retry: false })
}

type MessageType = 'EMAIL' | 'SMS' | 'MMS'
const CHANNELS: { value: 'EMAIL' | 'SMS'; label: string }[] = [
  { value: 'EMAIL', label: 'Email' },
  { value: 'SMS', label: 'SMS / MMS' },
]

export function NodeConfigPanel({ node, onClose, onSave, onDelete }: { node: EditorNode; onClose: () => void; onSave: (update: { type: JourneyNodeType; config: Record<string, unknown> }) => void; onDelete: () => void }) {
  const [type, setType] = useState<JourneyNodeType>(node.type)
  const [config, setConfig] = useState<Record<string, unknown>>(node.config)
  const set = (patch: Record<string, unknown>) => setConfig((prev) => ({ ...prev, ...patch }))
  const isMessage = type === 'EMAIL' || type === 'SMS' || type === 'MMS'

  const switchChannel = (channel: 'EMAIL' | 'SMS') => {
    if (channel === (type === 'EMAIL' ? 'EMAIL' : 'SMS')) return
    setType(channel)
    setConfig((prev) => {
      const next = { ...prev }
      delete next.template_id
      delete next.template_name
      return next
    })
  }

  return (
    <SidePanel
      title={describeStep({ ...node, type, config }).title}
      subtitle={categoryLine(type as AddableType)}
      onClose={onClose}
      footer={
        <div className="flex w-full gap-2">
          <button type="button" onClick={onDelete} className={buttonDanger}>
            <Trash2 size={16} strokeWidth={1.5} aria-hidden /> Delete Step
          </button>
          <button type="button" onClick={() => onSave({ type, config })} className={`${buttonPrimary} flex-1`}>Save Step</button>
        </div>
      }
    >
      {type === 'WAIT' && <WaitFields config={config} set={set} />}
      {type === 'CONDITION' && <ConditionFields config={config} set={set} />}
      {isMessage && (
        <div className="space-y-4">
          <div>
            <p className="block text-sm font-medium text-ink-800">Channel</p>
            <div className="mt-1">
              <SegmentedControl label="Channel" variant="solid" stretch options={CHANNELS} value={type === 'EMAIL' ? 'EMAIL' : 'SMS'} onChange={switchChannel} />
            </div>
          </div>
          <MessageFields key={type} type={type as MessageType} config={config} set={set} />
        </div>
      )}
      {type === 'COUPON_ISSUE' && <CouponFields config={config} set={set} />}
      {type === 'LOYALTY_CHANGE' && <TierFields config={config} set={set} />}
      {type === 'SEGMENT_UPDATE' && <SegmentFields config={config} set={set} />}
      {type === 'EXIT' && <p className="text-sm text-ink-800">Nothing to configure — this ends the journey for the customer.</p>}
    </SidePanel>
  )
}

type SetFn = (patch: Record<string, unknown>) => void

function WaitFields({ config, set }: { config: Record<string, unknown>; set: SetFn }) {
  return (
    <div className="space-y-4">
      <Field label="Duration" required>
        {(ids) => <TextInput {...ids} type="number" min={0} value={String(config.duration ?? '')} onChange={(event) => set({ duration: event.target.value === '' ? '' : Number(event.target.value) })} />}
      </Field>
      <Field label="Unit">
        {(ids) => (
          <Select {...ids} value={String(config.unit ?? 'DAYS')} onChange={(event) => set({ unit: event.target.value })}>
            {WAIT_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
          </Select>
        )}
      </Field>
    </div>
  )
}

function ConditionFields({ config, set }: { config: Record<string, unknown>; set: SetFn }) {
  const check = String(config.check ?? '')
  const segments = useQuery({ queryKey: ['audiences', 'options'], queryFn: ({ signal }) => api.get<Audience[]>('/contact-lists/audiences/', undefined, signal) })
  return (
    <div className="space-y-4">
      <Field label="What to Check" required hint="Looks back to when the customer entered the journey, unless you give it a number of days below.">
        {(ids) => (
          <Select {...ids} value={check} onChange={(event) => set({ check: event.target.value })}>
            <option value="">Choose What to Check</option>
            {CHECK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Within How Many Days" hint="Leave blank to look back to when the customer entered.">
        {(ids) => <TextInput {...ids} type="number" min={0} value={String(config.days ?? '')} onChange={(event) => set({ days: event.target.value === '' ? '' : Number(event.target.value) })} />}
      </Field>
      {check === 'EVENT' && (
        <Field label="Event Type" required>
          {(ids) => <TextInput {...ids} value={String(config.event_type ?? '')} onChange={(event) => set({ event_type: event.target.value })} placeholder="e.g. CATEGORY_PURCHASE" />}
        </Field>
      )}
      {(check === 'OPENED' || check === 'CLICKED') && (
        <Field label="Which Message" hint="Leave blank to count any email sent earlier in this journey.">
          {(ids) => <TextInput {...ids} value={String(config.message_step ?? '')} onChange={(event) => set({ message_step: event.target.value })} placeholder="step key, optional" />}
        </Field>
      )}
      {check === 'IN_SEGMENT' && (
        <Field label="Segment" required>
          {(ids) =>
            segments.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading segments</p>
            : segments.isError ? <ErrorState error={segments.error} onRetry={() => void segments.refetch()} />
            : (
              <Select {...ids} value={String(config.segment_id ?? '')} onChange={(event) => set({ segment_id: event.target.value, segment_name: segments.data?.find((item) => item.id === event.target.value)?.name })}>
                <option value="">Choose a Segment</option>
                {(segments.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            )}
        </Field>
      )}
    </div>
  )
}

function MessageFields({ type, config, set }: { type: MessageType; config: Record<string, unknown>; set: SetFn }) {
  const templates = useQuery({ queryKey: ['templates', 'options', type], queryFn: ({ signal }) => api.get<Page<Template>>('/templates/', { page_size: 200, channel: type }, signal) })
  return (
    <div>
      <Field label="Template" required hint="Opens in Template Studio to edit design.">
        {(ids) =>
          templates.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading templates</p>
          : templates.isError ? <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />
          : (templates.data?.results.length ?? 0) === 0 ? <p className="text-sm text-ink-800">No {type} templates yet.</p>
          : (
            <Select {...ids} value={String(config.template_id ?? '')} onChange={(event) => set({ template_id: event.target.value, template_name: templates.data?.results.find((item) => item.id === event.target.value)?.name })}>
              <option value="">Choose a Template</option>
              {(templates.data?.results ?? []).filter((item) => item.status !== 'ARCHIVED').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          )}
      </Field>
    </div>
  )
}

function CouponFields({ config, set }: { config: Record<string, unknown>; set: SetFn }) {
  const coupons = useCoupons()
  return (
    <Field label="Coupon" required hint="Issues an existing coupon from C360; CEP doesn't create or manage coupons.">
      {(ids) =>
        coupons.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading coupons</p>
        : coupons.isError ? <ErrorState title="Couldn't load coupons" error={coupons.error} onRetry={() => void coupons.refetch()} />
        : (
          <Select {...ids} value={String(config.coupon_id ?? '')} onChange={(event) => set({ coupon_id: event.target.value, coupon_name: coupons.data?.find((item) => item.id === event.target.value)?.name })}>
            <option value="">Choose a Coupon</option>
            {(coupons.data ?? []).filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}
          </Select>
        )}
    </Field>
  )
}

function TierFields({ config, set }: { config: Record<string, unknown>; set: SetFn }) {
  const tiers = useLoyaltyTiers()
  return (
    <Field label="Loyalty Tier" required hint="Sets the customer's tier to this one; CEP doesn't run the loyalty program itself.">
      {(ids) =>
        tiers.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading tiers</p>
        : tiers.isError ? <ErrorState title="Couldn't load loyalty tiers" error={tiers.error} onRetry={() => void tiers.refetch()} />
        : (
          <Select {...ids} value={String(config.tier_id ?? '')} onChange={(event) => set({ tier_id: event.target.value, tier_name: tiers.data?.find((item) => item.id === event.target.value)?.name })}>
            <option value="">Choose a Tier</option>
            {(tiers.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        )}
    </Field>
  )
}

function SegmentFields({ config, set }: { config: Record<string, unknown>; set: SetFn }) {
  const segments = useQuery({ queryKey: ['audiences', 'options'], queryFn: ({ signal }) => api.get<Audience[]>('/contact-lists/audiences/', undefined, signal) })
  return (
    <div className="space-y-4">
      <Field label="Action" required>
        {(ids) => (
          <Select {...ids} value={String(config.action ?? 'ADD')} onChange={(event) => set({ action: event.target.value })}>
            <option value="ADD">Add to Segment</option>
            <option value="REMOVE">Remove from Segment</option>
          </Select>
        )}
      </Field>
      <Field label="Segment" required>
        {(ids) =>
          segments.isPending ? <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading segments</p>
          : segments.isError ? <ErrorState error={segments.error} onRetry={() => void segments.refetch()} />
          : (
            <Select {...ids} value={String(config.segment_id ?? '')} onChange={(event) => set({ segment_id: event.target.value, segment_name: segments.data?.find((item) => item.id === event.target.value)?.name })}>
              <option value="">Choose a Segment</option>
              {(segments.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          )}
      </Field>
    </div>
  )
}
