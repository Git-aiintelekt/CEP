/**
 * The Store Register's settings (option A of docs/mockups/receipt-layouts.html): the receipt's parts listed on the left,
 * the receipt in the middle on a sample transaction, the selected part's settings on the right. Controlled: every change
 * hands back the whole next settings object.
 */
import { AlignCenter, ChevronDown, ChevronUp, Columns3, Heading, Lock, Plus, Sigma, Smartphone, X } from 'lucide-react'
import { useId, useRef, useState, type ReactNode } from 'react'

import { Checkbox } from '@/components/Checkbox'
import { Counter, Field, Select, TextArea, TextInput } from '@/components/Form'
import { SegmentedControl } from '@/components/SegmentedControl'
import type { PersonalizationTag, RegisterColumnKey, RegisterSettings } from '@/lib/types'

import { renderRegisterEmailHtml } from './receiptEmailHtml'
import { REGISTER_SAMPLES } from './registerSamples'
import {
  COLUMN_DATA, FOLD_RULE, MAX_REGISTER_COLUMNS, MAX_REGISTER_FOOTER, MAX_REGISTER_LABEL, MAX_REGISTER_TITLE, MIDDLE_COLUMNS, REGISTER_COLUMNS, REGISTER_FIELD_DATA, folds,
} from './registerSettings'

export type RegisterPart = 'header' | 'columns' | 'totals' | 'footer' | 'phone'

const PARTS: { key: RegisterPart; label: string; Icon: typeof Heading }[] = [
  { key: 'header', label: 'Title & Header', Icon: Heading },
  { key: 'columns', label: 'Columns', Icon: Columns3 },
  { key: 'totals', label: 'Totals & Tenders', Icon: Sigma },
  { key: 'footer', label: 'Footer Text', Icon: AlignCenter },
  { key: 'phone', label: 'On Phones', Icon: Smartphone },
]

const PANEL_TITLE = 'px-3 pt-3 pb-2 text-xs font-semibold text-ink-800'
const ICON_BUTTON =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-ink-800 transition-colors duration-base ease-standard hover:bg-fill-subtle disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-transparent'

/** The parts of the receipt, under Presentation in the left panel. */
export function RegisterParts({ settings, selected, onSelect }: { settings: RegisterSettings; selected: RegisterPart; onSelect: (part: RegisterPart) => void }) {
  return (
    <>
      <h2 className={`${PANEL_TITLE} mt-2 border-t border-line`}>Receipt Parts</h2>
      <ul className="flex flex-col gap-0.5 px-2 pb-3">
        {PARTS.map(({ key, label, Icon }) => {
          const on = key === selected
          return (
            <li key={key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(key)}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm ${on ? 'bg-brand-100 font-semibold text-brand-800' : 'text-ink-900 hover:bg-surface-hover'}`}
              >
                <Icon size={16} strokeWidth={1.5} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {key === 'columns' && <span className="text-xs text-ink-800">{settings.columns.length}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

interface RegisterEditorProps {
  settings: RegisterSettings
  part: RegisterPart
  onChange: (next: RegisterSettings) => void
  disabled: boolean
  tags?: PersonalizationTag[]
}

/** The receipt on a sample, and the selected part's settings. */
export function RegisterEditor({ settings, part, onChange, disabled, tags = [] }: RegisterEditorProps) {
  const [sample, setSample] = useState(REGISTER_SAMPLES[0].key)
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop')
  const sampleId = useId()
  const transaction = (REGISTER_SAMPLES.find((entry) => entry.key === sample) ?? REGISTER_SAMPLES[0]).data
  const html = renderRegisterEmailHtml(transaction, settings)

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
          <label htmlFor={sampleId} className="text-sm text-ink-800">Sample</label>
          <Select id={sampleId} controlSize="sm" value={sample} onChange={(event) => setSample(event.target.value)} className="w-56">
            {REGISTER_SAMPLES.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
          </Select>
          <span className="flex-1" />
          <SegmentedControl label="Preview Width" value={device} options={[{ value: 'desktop', label: 'Desktop' }, { value: 'phone', label: 'Phone' }]} onChange={setDevice} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-subtle p-6">
          {device === 'desktop' ?
            // the same HTML the email carries
            <div data-testid="register-preview" className="mx-auto max-w-[600px]" dangerouslySetInnerHTML={{ __html: html }} />
          : // a frame 375 wide, so the phone rule (a media query) applies as it does in a phone's mail app
            <iframe
              title="Phone Preview"
              data-testid="register-phone-preview"
              sandbox=""
              className="mx-auto block h-[720px] w-[375px] max-w-full rounded-md border border-line bg-surface"
              srcDoc={`<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body{margin:0}${folds(settings) ? FOLD_RULE : ''}</style></head><body>${html}</body></html>`}
            />
          }
        </div>
      </div>
      <aside aria-label="Part Settings" className="flex h-full w-[312px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line bg-surface p-4 max-[1439px]:w-[288px] max-[1199px]:w-[272px]">
        {part === 'header' && <HeaderSettings settings={settings} onChange={onChange} disabled={disabled} />}
        {part === 'columns' && <ColumnSettings settings={settings} onChange={onChange} disabled={disabled} />}
        {part === 'totals' && <TotalsNote />}
        {part === 'footer' && <FooterSettings settings={settings} onChange={onChange} disabled={disabled} tags={tags} />}
        {part === 'phone' && <PhoneSettings settings={settings} onChange={onChange} disabled={disabled} />}
      </aside>
    </>
  )
}

function Heading2({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h2 className="text-card-title font-semibold text-ink-900">{children}</h2>
      {end}
    </div>
  )
}

function Help({ children }: { children: ReactNode }) {
  return <p className="text-xs text-ink-800">{children}</p>
}

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const next = [...list]
  ;[next[index], next[index + by]] = [next[index + by], next[index]]
  return next
}

function HeaderSettings({ settings, onChange, disabled }: { settings: RegisterSettings; onChange: (next: RegisterSettings) => void; disabled: boolean }) {
  const setField = (index: number, change: Partial<RegisterSettings['fields'][number]>) =>
    onChange({ ...settings, fields: settings.fields.map((field, at) => (at === index ? { ...field, ...change } : field)) })
  return (
    <>
      <Heading2>Title &amp; Header</Heading2>
      <Field label="Title" limit={{ used: settings.title.length, max: MAX_REGISTER_TITLE }} hint="Leave it empty for no title.">
        {({ id, describedBy }) => <TextInput id={id} describedBy={describedBy} controlSize="sm" value={settings.title} maxLength={MAX_REGISTER_TITLE} disabled={disabled} onChange={(event) => onChange({ ...settings, title: event.target.value })} />}
      </Field>
      <Help>The transaction’s numbers, printed in rows of three. Rename, hide or reorder them.</Help>
      <ul className="flex flex-col gap-2">
        {settings.fields.map((field, index) => {
          const name = REGISTER_FIELD_DATA[field.key]
          return (
            <li key={field.key} className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <TextInput aria-label={`Label: ${name}`} controlSize="sm" value={field.label} maxLength={MAX_REGISTER_LABEL} disabled={disabled} onChange={(event) => setField(index, { label: event.target.value })} className="min-w-0 flex-1" />
                <button type="button" aria-label={`Move Up: ${name}`} disabled={disabled || index === 0} onClick={() => onChange({ ...settings, fields: move(settings.fields, index, -1) })} className={ICON_BUTTON}>
                  <ChevronUp size={14} strokeWidth={1.5} aria-hidden />
                </button>
                <button type="button" aria-label={`Move Down: ${name}`} disabled={disabled || index === settings.fields.length - 1} onClick={() => onChange({ ...settings, fields: move(settings.fields, index, 1) })} className={ICON_BUTTON}>
                  <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
                </button>
              </div>
              <div className="flex items-center justify-between pl-0.5">
                <span className="text-xs text-ink-800">Shows: {name}</span>
                <Checkbox label="Show" checked={field.visible} disabled={disabled} onChange={(event) => setField(index, { visible: event.target.checked })} />
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}

function ColumnSettings({ settings, onChange, disabled }: { settings: RegisterSettings; onChange: (next: RegisterSettings) => void; disabled: boolean }) {
  const [adding, setAdding] = useState(false)
  const columns = settings.columns
  const used = new Set(columns.map((column) => column.key))
  const free = MIDDLE_COLUMNS.filter((key) => !used.has(key))
  const full = columns.length >= MAX_REGISTER_COLUMNS
  const setColumn = (index: number, change: Partial<RegisterSettings['columns'][number]>) =>
    onChange({ ...settings, columns: columns.map((column, at) => (at === index ? { ...column, ...change } : column)) })
  const add = (key: RegisterColumnKey) => {
    setAdding(false)
    onChange({ ...settings, columns: [...columns.slice(0, -1), { key, label: REGISTER_COLUMNS[key] }, columns[columns.length - 1]] })
  }
  const setUnder = (key: keyof RegisterSettings['under_item']) => (on: boolean) => onChange({ ...settings, under_item: { ...settings.under_item, [key]: on } })

  return (
    <>
      <Heading2 end={<span className="text-xs text-ink-800">{columns.length} of {MAX_REGISTER_COLUMNS}</span>}>Columns</Heading2>
      <Help>Rename a header, change what it shows, or reorder. The item is always first and its amount always last.</Help>
      <ul className="flex flex-col gap-2">
        {columns.map((column, index) => {
          const locked = index === 0 || index === columns.length - 1
          const name = COLUMN_DATA[column.key].name
          return (
            <li key={column.key} className="flex flex-col gap-1">
              <div className="flex items-center gap-1">
                <TextInput aria-label={`Header: ${name}`} controlSize="sm" value={column.label} maxLength={MAX_REGISTER_LABEL} disabled={disabled} onChange={(event) => setColumn(index, { label: event.target.value })} className="min-w-0 flex-1" />
                {locked ?
                  <span role="img" aria-label={`${name} is always shown`} title="Always shown" className="inline-flex h-7 w-[60px] shrink-0 items-center justify-center text-ink-800">
                    <Lock size={14} strokeWidth={1.5} aria-hidden />
                  </span>
                : <>
                    <button type="button" aria-label={`Move Up: ${name}`} disabled={disabled || index === 1} onClick={() => onChange({ ...settings, columns: move(columns, index, -1) })} className={ICON_BUTTON}>
                      <ChevronUp size={14} strokeWidth={1.5} aria-hidden />
                    </button>
                    <button type="button" aria-label={`Move Down: ${name}`} disabled={disabled || index === columns.length - 2} onClick={() => onChange({ ...settings, columns: move(columns, index, 1) })} className={ICON_BUTTON}>
                      <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
                    </button>
                  </>
                }
                <button type="button" aria-label={`Remove Column: ${name}`} disabled={disabled || locked} onClick={() => onChange({ ...settings, columns: columns.filter((_, at) => at !== index) })} className={`${ICON_BUTTON} ${locked ? 'invisible' : ''}`}>
                  <X size={14} strokeWidth={1.5} aria-hidden />
                </button>
              </div>
              {locked ?
                <span className="pl-0.5 text-xs text-ink-800">Shows: {name}</span>
              : <Select aria-label={`Shows: ${name}`} controlSize="sm" value={column.key} disabled={disabled}
                  onChange={(event) => { const key = event.target.value as RegisterColumnKey; setColumn(index, { key, label: column.label === REGISTER_COLUMNS[column.key] ? REGISTER_COLUMNS[key] : column.label }) }}>
                  {[column.key, ...free].map((key) => <option key={key} value={key}>{COLUMN_DATA[key].name}</option>)}
                </Select>
              }
              {index === 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-1 pl-0.5">
                  <span className="text-xs text-ink-800">Under the item:</span>
                  <Checkbox label="Discount" checked={settings.under_item.discount} disabled={disabled} onChange={(event) => setUnder('discount')(event.target.checked)} />
                  <Checkbox label="Qty @ Price" checked={settings.under_item.quantity_at_price} disabled={disabled} onChange={(event) => setUnder('quantity_at_price')(event.target.checked)} />
                  <Checkbox label="SKU" checked={settings.under_item.sku} disabled={disabled} onChange={(event) => setUnder('sku')(event.target.checked)} />
                  <Checkbox label="UPC" checked={settings.under_item.upc} disabled={disabled} onChange={(event) => setUnder('upc')(event.target.checked)} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-col gap-2">
        <button type="button" aria-expanded={adding} disabled={disabled || full || free.length === 0} onClick={() => setAdding((open) => !open)}
          className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-line-control bg-surface px-3 text-sm font-medium text-ink-900 transition-colors duration-base ease-standard hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-surface">
          <Plus size={14} strokeWidth={1.5} aria-hidden /> Add Column
        </button>
        {full && <Help>At most {MAX_REGISTER_COLUMNS} columns: a sixth does not fit a phone. Remove one to add another.</Help>}
        {adding && !full && (
          <ul aria-label="Add Column" className="flex flex-col rounded-md border border-line bg-surface p-1">
            {free.map((key) => (
              <li key={key}>
                <button type="button" onClick={() => add(key)} className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-ink-900 hover:bg-surface-hover">
                  <span>{COLUMN_DATA[key].name}</span>
                  <span className="text-xs text-ink-800">{COLUMN_DATA[key].sample}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function TotalsNote() {
  return (
    <>
      <Heading2>Totals &amp; Tenders</Heading2>
      <Help>The subtotal, each tax with its rate, the total, every tender with its authorisation, and the change for cash. They come from the transaction as the register prints them, so there is nothing to set here.</Help>
    </>
  )
}

function FooterSettings({ settings, onChange, disabled, tags }: { settings: RegisterSettings; onChange: (next: RegisterSettings) => void; disabled: boolean; tags: PersonalizationTag[] }) {
  const text = useRef<HTMLTextAreaElement>(null)
  const id = useId()
  const offered = tags.filter((tag) => !tag.applies_to_channels?.length || tag.applies_to_channels.includes('E_RECEIPT') || tag.applies_to_channels.includes('EMAIL'))

  function insert(key: string) {
    if (!key) return
    const token = `{{${key}}}`
    const area = text.current
    const start = area?.selectionStart ?? settings.footer_text.length
    const end = area?.selectionEnd ?? start
    const next = settings.footer_text.slice(0, start) + token + settings.footer_text.slice(end)
    if (next.length > MAX_REGISTER_FOOTER) return
    onChange({ ...settings, footer_text: next })
    window.setTimeout(() => {
      area?.focus()
      area?.setSelectionRange(start + token.length, start + token.length)
    }, 0)
  }

  return (
    <>
      <Heading2>Footer Text</Heading2>
      <Help>Text inside the receipt, under the totals: a thank-you, the return policy. Tags are filled for each receipt; line breaks are kept.</Help>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium text-ink-900">Text</label>
        <TextArea id={id} ref={text} rows={5} value={settings.footer_text} maxLength={MAX_REGISTER_FOOTER} disabled={disabled} onChange={(event) => onChange({ ...settings, footer_text: event.target.value })} />
        <div className="flex items-center justify-between gap-2">
          {offered.length > 0 ?
            <Select aria-label="Insert Tag" controlSize="sm" value="" disabled={disabled} onChange={(event) => insert(event.target.value)} className="w-44">
              <option value="">Insert Tag…</option>
              {offered.map((tag) => {
                const key = tag.tag_key.replace(/[{}$\s]/g, '')
                return <option key={tag.id} value={key}>{tag.label || key}</option>
              })}
            </Select>
          : <span />}
          <Counter used={settings.footer_text.length} max={MAX_REGISTER_FOOTER} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-ink-900">Alignment</p>
        <SegmentedControl label="Footer Alignment" variant="outline" disabled={disabled} value={settings.footer_align}
          options={[{ value: 'CENTER', label: 'Centre' }, { value: 'LEFT', label: 'Left' }]} onChange={(footer_align) => onChange({ ...settings, footer_align })} />
      </div>
      <Help>A tag that is empty for a receipt drops out with nothing in its place.</Help>
    </>
  )
}

function PhoneSettings({ settings, onChange, disabled }: { settings: RegisterSettings; onChange: (next: RegisterSettings) => void; disabled: boolean }) {
  const name = useId()
  const options = [
    { value: 'FOLD' as const, title: 'Fold Extra Columns Under the Item', help: 'The item and its amount stay columns; the others move to a line under the item.' },
    { value: 'KEEP' as const, title: 'Keep Every Column', help: 'Columns get narrower; long values wrap.' },
  ]
  return (
    <>
      <Heading2>On Phones</Heading2>
      <Help>The email is 600 pixels wide; phones show it at about 375. {settings.columns.length > 2 ? '' : 'With two columns there is nothing to fold.'}</Help>
      <div role="radiogroup" aria-label="On Phones" className="flex flex-col gap-1.5">
        {options.map((option) => {
          const checked = settings.phone === option.value
          return (
            <label key={option.value} className={`flex cursor-pointer gap-2 rounded-md border px-3 py-2 ${checked ? 'border-link bg-brand-100' : 'border-line hover:bg-surface-hover'}`}>
              <input type="radio" name={name} value={option.value} checked={checked} disabled={disabled} onChange={() => onChange({ ...settings, phone: option.value })} className="mt-1" />
              <span className="flex flex-col">
                <span className="text-sm font-semibold text-ink-900">{option.title}</span>
                <span className="text-xs text-ink-800">{option.help}</span>
              </span>
            </label>
          )
        })}
      </div>
      <Help>Mail apps that ignore phone rules (some Outlook versions) show every column.</Help>
    </>
  )
}
