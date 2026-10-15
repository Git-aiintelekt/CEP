/**
 * Receipt layout: how the itemized receipt inside the outer design is put together. Presets on the left, the
 * receipt in the middle, the selected section's settings on the right. Controlled: every change hands back the
 * whole next layout, and saving is the workspace's business.
 */
import { ChevronDown, ChevronUp, Lock } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

import { Field, Select, TextArea } from '@/components/Form'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Switch } from '@/components/Switch'
import { titleCase } from '@/lib/format'
import type { ReceiptLayout, ReceiptSection, ReceiptSectionKey } from '@/lib/types'

import { ReceiptPreview } from './ReceiptPreview'
import { renderRegisterEmailHtml } from './receiptEmailHtml'
import { PRESET_CARDS, defaultSectionsFor, inOrder, moveSection } from './receiptPresets'
import { DEFAULT_SAMPLE_TRANSACTION, SAMPLE_TRANSACTIONS } from './sampleReceiptData'

export type ReceiptLayoutConfig = Pick<ReceiptLayout, 'layout_preset' | 'sections' | 'custom_html' | 'custom_css'>

interface ReceiptLayoutPaneProps {
  layout: ReceiptLayoutConfig
  onChange: (next: ReceiptLayoutConfig) => void
  readOnly?: boolean
}

const PANEL_TITLE = 'px-3 pt-3 pb-2 text-xs font-semibold text-ink-800'
/** the in-store sale: the one sample that carries register details */
const REGISTER_SAMPLE = SAMPLE_TRANSACTIONS.find((entry) => entry.data.register)?.data ?? DEFAULT_SAMPLE_TRANSACTION

export function ReceiptLayoutPane({ layout, onChange, readOnly = false }: ReceiptLayoutPaneProps) {
  const [selectedKey, setSelectedKey] = useState<ReceiptSectionKey>('items')
  const [insideShell, setInsideShell] = useState(false)
  const custom = layout.layout_preset === 'CUSTOM_HTML'
  const register = layout.layout_preset === 'REGISTER'
  const sections = inOrder(layout.sections)
  const selected = sections.find((section) => section.key === selectedKey) ?? sections[0]

  const replace = (next: ReceiptSection) =>
    onChange({ ...layout, sections: layout.sections.map((section) => (section.key === next.key ? next : section)) })

  const choosePreset = (preset: ReceiptLayout['layout_preset']) => {
    if (preset === layout.layout_preset) return
    if (preset === 'CUSTOM_HTML') onChange({ ...layout, layout_preset: preset, custom_html: layout.custom_html ?? '', custom_css: layout.custom_css ?? '' })
    else onChange({ ...layout, layout_preset: preset, sections: defaultSectionsFor(preset) })
  }

  return (
    <div className="flex h-full min-h-0 bg-canvas">
      <aside aria-label="Receipt Layout" className="flex h-full w-[264px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface">
        <h2 className={PANEL_TITLE}>Presentation</h2>
        <PresetCards value={layout.layout_preset} disabled={readOnly} onChange={choosePreset} />
        {custom || register ? null : (
          <>
            <h2 className={`${PANEL_TITLE} mt-2 border-t border-line`}>Receipt Sections</h2>
            <ul className="flex flex-col gap-0.5 px-2 pb-3">
              {sections.map((section, index) => (
                <SectionRow
                  key={section.key}
                  section={section}
                  selected={section.key === selected?.key}
                  first={index === 0}
                  last={index === sections.length - 1}
                  disabled={readOnly}
                  onSelect={() => setSelectedKey(section.key)}
                  onVisible={(visible) => replace({ ...section, visible })}
                  onMove={(direction) => onChange({ ...layout, sections: moveSection(layout.sections, section.key, direction) })}
                />
              ))}
            </ul>
          </>
        )}
      </aside>

      {custom ?
        <CustomHtml layout={layout} disabled={readOnly} onChange={onChange} />
      : register ?
        <>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto bg-surface-subtle p-6">
              {/* the same HTML the email carries; the sample is a point-of-sale transaction with its register details */}
              <div data-testid="register-preview" className="mx-auto max-w-[600px]" dangerouslySetInnerHTML={{ __html: renderRegisterEmailHtml(REGISTER_SAMPLE) }} />
            </div>
          </div>
          <aside aria-label="Section Settings" className="flex h-full w-[296px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface p-4 max-[1439px]:w-[272px] max-[1199px]:w-[264px]">
            <h2 className="text-card-title font-semibold text-ink-900">Store Register</h2>
            <p className="mt-2 text-sm text-ink-800">The receipt as the register prints it: the transaction numbers, each line with its discount and quantity at price, the lines’ sum, then the subtotal, every tax with its rate, the total, each tender with its authorisation, and the change.</p>
            <p className="mt-2 text-sm text-ink-800">Everything comes from the transaction, so there is nothing to configure here. Choose Standard, Compact or Itemized for sections you can switch and reorder.</p>
          </aside>
        </>
      : <>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-line bg-surface px-4">
              <Switch checked={insideShell} onChange={setInsideShell} label="Show Inside Email Shell" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-surface-subtle p-6">
              <div className="mx-auto max-w-[600px]">
                <ReceiptPreview sections={layout.sections} transaction={DEFAULT_SAMPLE_TRANSACTION} insideShell={insideShell} />
              </div>
            </div>
          </div>
          <aside
            aria-label="Section Settings"
            className="flex h-full w-[296px] shrink-0 flex-col overflow-y-auto border-l border-line bg-surface max-[1439px]:w-[272px] max-[1199px]:w-[264px]"
          >
            {selected ? <SectionSettings section={selected} disabled={readOnly} onChange={replace} /> : null}
          </aside>
        </>
      }
    </div>
  )
}

function PresetCards({ value, disabled, onChange }: { value: ReceiptLayout['layout_preset']; disabled: boolean; onChange: (preset: ReceiptLayout['layout_preset']) => void }) {
  return (
    <div role="radiogroup" aria-label="Presentation" className="flex flex-col gap-1.5 px-2">
      {PRESET_CARDS.map((card) => {
        const checked = card.value === value
        return (
          <button
            key={card.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(card.value)}
            className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors duration-base ease-standard disabled:cursor-not-allowed ${
              checked ? 'border-link bg-brand-100' : 'border-line bg-surface hover:bg-surface-hover'
            }`}
          >
            <span className={`text-sm font-semibold ${checked ? 'text-brand-800' : 'text-ink-900'}`}>{card.title}</span>
            <span className="text-xs text-ink-800">{card.description}</span>
          </button>
        )
      })}
    </div>
  )
}

interface SectionRowProps {
  section: ReceiptSection
  selected: boolean
  first: boolean
  last: boolean
  disabled: boolean
  onSelect: () => void
  onVisible: (visible: boolean) => void
  onMove: (direction: 'up' | 'down') => void
}

const ICON_BUTTON =
  'inline-flex h-6 w-6 items-center justify-center rounded-sm text-ink-800 transition-colors duration-base ease-standard hover:bg-fill-subtle disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-transparent'

/** Only visibility is fixed for a locked section; every section, locked or not, moves freely. */
function SectionRow({ section, selected, first, last, disabled, onSelect, onVisible, onMove }: SectionRowProps) {
  const hidden = !section.locked && !section.visible
  const label = titleCase(section.label)
  return (
    <li
      data-section-row={section.key}
      data-hidden={hidden || undefined}
      className={`flex items-center gap-1 rounded-sm pr-1 ${selected ? 'bg-brand-100' : 'hover:bg-surface-hover'}`}
    >
      <button
        type="button"
        aria-pressed={selected}
        title={label}
        onClick={onSelect}
        className={`min-w-0 flex-1 truncate py-2 pl-2 text-left text-sm ${hidden ? 'text-ink-300' : selected ? 'font-semibold text-brand-800' : 'text-ink-900'}`}
      >
        {label}
      </button>
      {section.locked ?
        <span role="img" aria-label={`${label} is always shown`} title="Always shown" className="inline-flex h-6 w-8 items-center justify-center text-ink-800">
          <Lock size={14} strokeWidth={1.5} aria-hidden />
        </span>
      : <Switch checked={section.visible} onChange={onVisible} ariaLabel={`Show ${label}`} disabled={disabled} />}
      <button type="button" aria-label={`Move Up: ${label}`} disabled={disabled || first} onClick={() => onMove('up')} className={ICON_BUTTON}>
        <ChevronUp size={14} strokeWidth={1.5} aria-hidden />
      </button>
      <button type="button" aria-label={`Move Down: ${label}`} disabled={disabled || last} onClick={() => onMove('down')} className={ICON_BUTTON}>
        <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
      </button>
    </li>
  )
}

function Toggle({ label, help, checked, disabled, onChange }: { label: string; help?: string; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-sm text-ink-900">{label}</p>
        {help ? <p id={`${id}-help`} className="text-xs text-ink-800">{help}</p> : null}
      </div>
      <Switch checked={checked} onChange={onChange} labelledBy={`${id}-label`} describedBy={help ? `${id}-help` : undefined} disabled={disabled} />
    </div>
  )
}

function Group({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-line-subtle px-3">{children}</div>
}

const ADDRESS_MODES = [
  { value: 'AUTO', label: 'Auto from Order' },
  { value: 'SHIP_TO', label: 'Ship To' },
  { value: 'PICKUP', label: 'Pickup At' },
] as const

/** Each section offers exactly what its own shape holds: the switch is over the section's key. */
function SectionSettings({ section, disabled, onChange }: { section: ReceiptSection; disabled: boolean; onChange: (next: ReceiptSection) => void }) {
  let body: ReactNode
  switch (section.key) {
    case 'header': {
      const set = (key: keyof typeof section.fields) => (on: boolean) => onChange({ ...section, fields: { ...section.fields, [key]: on } })
      body = (
        <Group>
          <Toggle label="Order Number" checked={section.fields.order_number} disabled={disabled} onChange={set('order_number')} />
          <Toggle label="Order Date" checked={section.fields.order_date} disabled={disabled} onChange={set('order_date')} />
          <Toggle label="Store or Channel" checked={section.fields.store} disabled={disabled} onChange={set('store')} />
          <Toggle label="Receipt ID" help="Needed for expense and tax claims" checked={section.fields.receipt_id} disabled={disabled} onChange={set('receipt_id')} />
        </Group>
      )
      break
    }
    case 'customer_fulfillment':
      body = (
        <div className="flex flex-col gap-2 px-3 py-2">
          <Field label="Address Shown">
            {({ id }) => (
              <Select
                id={id}
                controlSize="sm"
                value={section.address_mode}
                disabled={disabled}
                onChange={(event) => onChange({ ...section, address_mode: event.target.value as typeof section.address_mode })}
              >
                {ADDRESS_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Toggle label="Delivery Estimate" checked={section.delivery_estimate} disabled={disabled} onChange={(on) => onChange({ ...section, delivery_estimate: on })} />
        </div>
      )
      break
    case 'items': {
      const set = (key: keyof typeof section.columns) => (on: boolean) => onChange({ ...section, columns: { ...section.columns, [key]: on } })
      body = (
        <>
          <Group>
            <Toggle label="Product Image" checked={section.columns.product_image} disabled={disabled} onChange={set('product_image')} />
            <Toggle label="SKU" checked={section.columns.sku} disabled={disabled} onChange={set('sku')} />
            <Toggle label="Quantity" checked={section.columns.quantity} disabled={disabled} onChange={set('quantity')} />
            <Toggle label="Unit Price" checked={section.columns.unit_price} disabled={disabled} onChange={set('unit_price')} />
            <Toggle label="Amount" checked={section.columns.amount} disabled={disabled} onChange={set('amount')} />
          </Group>
          <div className="flex flex-col gap-1.5 border-t border-line-subtle px-3 py-3">
            <p className="text-sm text-ink-900">Row Height</p>
            <SegmentedControl
              label="Row Height"
              variant="outline"
              stretch
              disabled={disabled}
              value={section.row_height}
              options={[{ value: 'COMPACT', label: 'Compact' }, { value: 'DEFAULT', label: 'Default' }]}
              onChange={(row_height) => onChange({ ...section, row_height })}
            />
          </div>
        </>
      )
      break
    }
    case 'totals': {
      const set = (key: keyof typeof section.rows) => (on: boolean) => onChange({ ...section, rows: { ...section.rows, [key]: on } })
      body = (
        <Group>
          <Toggle label="Subtotal" checked={section.rows.subtotal} disabled={disabled} onChange={set('subtotal')} />
          <Toggle label="Discounts" checked={section.rows.discount} disabled={disabled} onChange={set('discount')} />
          <Toggle label="Tax" checked={section.rows.tax} disabled={disabled} onChange={set('tax')} />
          <Toggle label="Shipping" checked={section.rows.shipping} disabled={disabled} onChange={set('shipping')} />
          <Toggle label="Tip" checked={section.rows.tip} disabled={disabled} onChange={set('tip')} />
          <Toggle label="Savings Callout" checked={section.savings_callout} disabled={disabled} onChange={(on) => onChange({ ...section, savings_callout: on })} />
        </Group>
      )
      break
    }
    case 'payment': {
      const set = (key: keyof typeof section.fields) => (on: boolean) => onChange({ ...section, fields: { ...section.fields, [key]: on } })
      body = (
        <Group>
          <Toggle label="Payment Method" help="Always masked to the last four digits" checked={section.fields.method} disabled={disabled} onChange={set('method')} />
          <Toggle label="Authorization Time" checked={section.fields.authorization_time} disabled={disabled} onChange={set('authorization_time')} />
          <Toggle label="Billing Address" checked={section.fields.billing_address} disabled={disabled} onChange={set('billing_address')} />
        </Group>
      )
      break
    }
    case 'loyalty': {
      const set = (key: keyof typeof section.fields) => (on: boolean) => onChange({ ...section, fields: { ...section.fields, [key]: on } })
      body = (
        <Group>
          <Toggle label="Points Earned" checked={section.fields.points_earned} disabled={disabled} onChange={set('points_earned')} />
          <Toggle label="Points Balance" checked={section.fields.points_balance} disabled={disabled} onChange={set('points_balance')} />
          <Toggle label="Tier Progress" checked={section.fields.tier_progress} disabled={disabled} onChange={set('tier_progress')} />
        </Group>
      )
      break
    }
    case 'support':
      body = (
        <div className="flex flex-col gap-2 px-3 py-2">
          <Field label="Policy Text">
            {({ id }) => (
              <TextArea id={id} rows={5} value={section.policy_text} disabled={disabled} onChange={(event) => onChange({ ...section, policy_text: event.target.value })} />
            )}
          </Field>
          <Toggle label="In-Store Return Barcode" checked={section.barcode} disabled={disabled} onChange={(on) => onChange({ ...section, barcode: on })} />
        </div>
      )
      break
  }

  return (
    <>
      <div className="flex flex-col items-start gap-1.5 border-b border-line p-3">
        <h2 className="text-sm font-semibold text-ink-900">{titleCase(section.label)}</h2>
        {section.data_binding ?
          <span className="rounded-sm bg-fill-subtle px-1.5 py-0.5 text-xs text-ink-800">Mapped to {section.data_binding}</span>
        : null}
      </div>
      {body}
    </>
  )
}

function CustomHtml({ layout, disabled, onChange }: { layout: ReceiptLayoutConfig; disabled: boolean; onChange: (next: ReceiptLayoutConfig) => void }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto bg-surface p-6">
      <p className="text-sm text-ink-800">The receipt is your own HTML and CSS. Choose a preset to go back to the section layout.</p>
      <Field label="HTML">
        {({ id }) => (
          <TextArea
            id={id}
            rows={14}
            spellCheck={false}
            value={layout.custom_html ?? ''}
            disabled={disabled}
            onChange={(event) => onChange({ ...layout, custom_html: event.target.value })}
            className="font-mono"
          />
        )}
      </Field>
      <Field label="CSS">
        {({ id }) => (
          <TextArea
            id={id}
            rows={8}
            spellCheck={false}
            value={layout.custom_css ?? ''}
            disabled={disabled}
            onChange={(event) => onChange({ ...layout, custom_css: event.target.value })}
            className="font-mono"
          />
        )}
      </Field>
    </div>
  )
}
