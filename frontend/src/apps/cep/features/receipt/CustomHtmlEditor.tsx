/**
 * A Custom HTML receipt: the Receipt (the HTML around the lines), the Item Row (written once, repeated per line at
 * {{receipt_items}}) and the CSS, with the item tags to insert, the checks the server also makes, and the receipt on a
 * sample. The server's twin is receipt_layout.item_rows and design.receipt_content_errors.
 */
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { SegmentedControl } from '@/components/SegmentedControl'
import { TextArea } from '@/components/Form'

import { renderCustomReceiptHtml } from './receiptEmailHtml'
import { REGISTER_SAMPLES } from './registerSamples'
import { customHtmlChecks, type CustomHtmlValue } from './customHtmlChecks'
import { ITEM_TAGS } from './registerSettings'

type Part = 'html' | 'row' | 'css'

export function CustomHtmlEditor({ value, onChange, disabled }: { value: CustomHtmlValue; onChange: (next: CustomHtmlValue) => void; disabled: boolean }) {
  const [part, setPart] = useState<Part>('html')
  const [sample, setSample] = useState(REGISTER_SAMPLES[0].key)
  const area = useRef<HTMLTextAreaElement>(null)
  const areaId = useId()
  const field: keyof CustomHtmlValue = part === 'html' ? 'custom_html' : part === 'row' ? 'item_row' : 'custom_css'
  const text = value[field] ?? ''
  const transaction = (REGISTER_SAMPLES.find((entry) => entry.key === sample) ?? REGISTER_SAMPLES[0]).data
  const checks = customHtmlChecks(value)

  function insert(token: string) {
    const element = area.current
    const start = element?.selectionStart ?? text.length
    const end = element?.selectionEnd ?? start
    onChange({ ...value, [field]: text.slice(0, start) + token + text.slice(end) })
    window.setTimeout(() => {
      element?.focus()
      element?.setSelectionRange(start + token.length, start + token.length)
    }, 0)
  }

  const tokens = part === 'row' ? ITEM_TAGS.map((tag) => ({ token: `{{item.${tag.key}}}`, hint: tag.sample })) : part === 'html' ? [{ token: '{{receipt_items}}', hint: 'the item rows' }] : []

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto border-r border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl label="Part" value={part} onChange={setPart} options={[{ value: 'html', label: 'Receipt' }, { value: 'row', label: 'Item Row' }, { value: 'css', label: 'CSS' }]} />
        </div>
        <p className="text-xs text-ink-800">
          {part === 'html' ? 'The HTML around the lines. Put {{receipt_items}} where the item rows go; every other tag works here too.'
          : part === 'row' ? 'One line of the receipt, usually a table row. It is repeated once per item, with the item tags filled in.'
          : 'Styles for the receipt. Some mail apps drop styles, so the HTML’s own style attributes are the safer place.'}
        </p>
        {tokens.length > 0 && (
          <div aria-label={part === 'row' ? 'Item Tags' : 'Receipt Tags'} className="flex flex-wrap gap-1.5">
            {tokens.map(({ token, hint }) => (
              <button key={token} type="button" disabled={disabled} title={hint} onClick={() => insert(token)}
                className="rounded-sm bg-brand-100 px-1.5 py-0.5 font-mono text-xs text-brand-800 hover:underline disabled:cursor-not-allowed disabled:opacity-60">
                {token}
              </button>
            ))}
          </div>
        )}
        <label htmlFor={areaId} className="sr-only">{part === 'html' ? 'Receipt HTML' : part === 'row' ? 'Item Row' : 'CSS'}</label>
        <TextArea id={areaId} ref={area} rows={16} spellCheck={false} value={text} disabled={disabled} onChange={(event) => onChange({ ...value, [field]: event.target.value })} className="font-mono" />
        <ul aria-label="Checks" className="flex flex-col gap-1.5">
          {checks.map((check) => (
            <li key={check.title} className={`flex items-start gap-2 rounded-md px-2.5 py-2 text-xs ${check.ok ? 'bg-surface-subtle text-ink-900' : check.warning ? 'bg-warning-bg text-warning-text' : 'bg-danger-bg text-danger-text'}`}>
              {check.ok ? <CheckCircle2 size={14} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0 text-success-text" /> : <AlertTriangle size={14} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0" />}
              <span><span className="font-semibold">{check.title}</span>{check.detail ? ` ${check.detail}` : ''}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
          <span className="text-sm text-ink-800">Sample</span>
          <SegmentedControl label="Sample" variant="outline" value={sample} onChange={setSample} options={REGISTER_SAMPLES.map((entry) => ({ value: entry.key, label: entry.label }))} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-subtle p-6">
          {/* a sandboxed frame: the author's CSS stays inside it, as it does in the email */}
          <iframe
            title="Receipt Preview"
            data-testid="custom-html-preview"
            sandbox=""
            className="mx-auto block h-[640px] w-full max-w-[600px] rounded-md border border-line bg-surface"
            srcDoc={`<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="margin:0">${value.custom_html ? renderCustomReceiptHtml(value.custom_html, value.custom_css, value.item_row, transaction) : ''}</body></html>`}
          />
        </div>
      </div>
    </>
  )
}
