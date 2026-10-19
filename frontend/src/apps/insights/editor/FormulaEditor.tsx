/**
 * A formula and a measure formula, written: the text, the fields and functions to put in at the cursor, and the check as you
 * type (what it works out, which fields it reads, or what is wrong and where). A number formula is used as a measure (adds up)
 * or a dimension (groups); a number is shown as a whole number, a decimal, money or a percentage.
 */
import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Select, TextArea, TextInput } from '@/components/Form'
import { Spinner } from '@/components/States'
import { formulasApi } from '../api'
import type { CatalogDataset, CustomField, FormulaCheck } from '../types'
import { withCustom } from './definition'
import { FORMAT_LABEL, FORMULA_FUNCTIONS, insertAt } from './formulaHelp'

const TYPE_WORDS: Record<string, string> = { number: 'a number', string: 'text', boolean: 'yes or no', date: 'a date', datetime: 'a date and time' }
const FIELD_TYPE: Record<string, string> = { number: 'number', string: 'text', boolean: 'yes/no', date: 'date', datetime: 'date and time' }

interface FormulaEditorProps {
  dataset: CatalogDataset
  kind: 'formula' | 'measure'
  label: string
  fieldKey?: string
  expression: string
  role: '' | 'dimension' | 'measure'
  format: string
  /** the custom fields before this one: a formula may read them */
  before: CustomField[]
  onChange: (patch: { expression?: string; role?: '' | 'dimension' | 'measure'; format?: string }) => void
  /** the field as it would be saved, once the formula checks out; null while it does not */
  onChecked: (spec: CustomField | null) => void
  /** checks against something else than the report's own fields (a shared formula, against the dataset's) */
  checkWith?: { key: string; check: (field: Partial<CustomField>) => Promise<FormulaCheck> }
}

function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return settled
}

export function FormulaEditor({ dataset, kind, label, fieldKey, expression, role, format, before, onChange, onChecked, checkWith }: FormulaEditorProps) {
  const box = useRef<HTMLTextAreaElement>(null)
  const [search, setSearch] = useState('')
  const asked = useSettled({ expression, kind, role, format, label }, 400)
  const check = useQuery<FormulaCheck>({
    queryKey: ['insights', 'formula-check', dataset.key, checkWith?.key ?? null, before, fieldKey, asked],
    queryFn: () => {
      const field: Partial<CustomField> = { ...(fieldKey ? { key: fieldKey } : {}), label: asked.label.trim() || 'Formula', kind: asked.kind, expression: asked.expression,
        ...(asked.role ? { role: asked.role } : {}), ...(asked.format ? { format: asked.format as CustomField['format'] } : {}) }
      return checkWith ? checkWith.check(field) : formulasApi.check({ dataset: dataset.key, derived: before, field })
    },
    enabled: asked.expression.trim().length > 0,
    retry: false,
    placeholderData: (previous) => previous,
  })
  const fresh = check.data && !check.isFetching && asked.expression === expression && asked.role === role && asked.format === format && asked.label === label
  const result = fresh ? check.data : undefined
  useEffect(() => { onChecked(result?.ok && result.spec ? { ...result.spec, label: label.trim() || result.spec.label } : null) }, [result, label, onChecked])

  function put(piece: string) {
    const at = box.current?.selectionStart ?? expression.length
    const next = insertAt(expression, at, piece)
    onChange({ expression: next.text })
    window.requestAnimationFrame(() => { box.current?.focus(); box.current?.setSelectionRange(next.cursor, next.cursor) })
  }

  const fields = withCustom(dataset, { columns: [], derived: before }).fields.filter((f) => f.key !== fieldKey && f.label.toLowerCase().includes(search.trim().toLowerCase()))
  const olderMysql = dataset.database?.engine === 'mysql57'
  const groups = FORMULA_FUNCTIONS.filter((g) => !(olderMysql && g.windowed)).map((g) => ({ ...g, items: g.items.filter((f) => kind === 'measure' || !f.measureOnly) })).filter((g) => g.items.length)
  const number = result?.ok ? result.spec?.type === 'number' : true

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-label font-medium text-ink-800">Formula
        <TextArea ref={box} aria-label="Formula" rows={4} spellCheck={false} value={expression} onChange={(e) => onChange({ expression: e.target.value })}
          className="font-mono text-sm" placeholder={kind === 'measure' ? 'DIVIDE(SUM([Delivered Count]), SUM([Sent Count])) * 100' : 'IF([Amount] >= 500, "Gold", "Standard")'} />
      </label>
      <div role="status" aria-live="polite" className="min-h-5 text-sm">
        {!expression.trim() ? <span className="text-ink-700">{kind === 'measure' ? 'A measure formula adds up the rows of each group, such as SUM([Sent Count], [Channel] = "EMAIL").' : 'A formula works out one value for each row, such as [Revenue] - [Cost].'}</span>
          : !result ? <span className="inline-flex items-center gap-2 text-ink-800"><Spinner size="sm" />Checking</span>
          : result.ok ? (
            <span className="inline-flex items-start gap-1.5 text-success-text">
              <Check size={16} strokeWidth={1.5} aria-hidden className="mt-0.5 shrink-0" />
              <span>Works out {TYPE_WORDS[result.spec?.type ?? 'number']}{kind === 'formula' ? `, used as ${result.role === 'measure' ? 'a measure' : 'a dimension'}` : ''}. Reads {result.uses?.join(', ') || 'no field'}.{result.personal ? ' It reads personal data, so it is personal too.' : ''}{result.analytic ? ' It is worked out over the report\'s grouped rows, so totals leave it empty.' : ''}</span>
            </span>
          ) : (
            <span className="flex flex-col gap-1 text-danger-text">
              <span>{result.message}</span>
              {typeof result.at === 'number' && expression && <ErrorPlace text={expression} at={result.at} />}
            </span>
          )}
      </div>
      {(kind === 'formula' || number) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {kind === 'formula' && number && (
            <label className="flex flex-col gap-1 text-label font-medium text-ink-800">Use As
              <Select aria-label="Use as" value={role || (result?.role ?? '')} onChange={(e) => onChange({ role: e.target.value as 'dimension' | 'measure' })}>
                <option value="measure">A Measure (Adds Up)</option><option value="dimension">A Dimension (Groups)</option>
              </Select>
            </label>
          )}
          {number && (
            <label className="flex flex-col gap-1 text-label font-medium text-ink-800">Show As
              <Select aria-label="Show as" value={format} onChange={(e) => onChange({ format: e.target.value })}>
                {Object.entries(FORMAT_LABEL).map(([value, words]) => <option key={value} value={value}>{words}</option>)}
              </Select>
            </label>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-label="Fields to put in" className="flex min-w-0 flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-ink-800 uppercase">Fields</h3>
          <TextInput aria-label="Search fields" controlSize="sm" placeholder="Search fields" value={search} onChange={(e) => setSearch(e.target.value)} />
          <ul className="max-h-48 overflow-y-auto rounded-md border border-line">
            {fields.map((f) => (
              <li key={f.key}><button type="button" onClick={() => put(`[${f.label}]`)} className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm text-ink-900 hover:bg-surface-hover">
                <span className="inline-flex min-w-0 items-center gap-1"><span className="truncate">{f.label}</span>{f.shared?.certified && <BadgeCheck size={14} strokeWidth={1.5} aria-label="Certified" className="shrink-0 text-success-text" />}</span>
                <span className="shrink-0 text-xs text-ink-700">{f.aggregates.includes('calc') ? 'measure' : FIELD_TYPE[f.type]}</span>
              </button></li>
            ))}
          </ul>
        </section>
        <section aria-label="Functions" className="flex min-w-0 flex-col gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-ink-800 uppercase">Functions</h3>
          <ul className="max-h-[14.5rem] overflow-y-auto rounded-md border border-line">
            {groups.map((g) => (
              <li key={g.group}>
                <p className="bg-surface-subtle px-2.5 py-1 text-xs font-semibold text-ink-800">{g.group}</p>
                <ul>
                  {g.items.map((f) => (
                    <li key={f.name}><button type="button" onClick={() => put(f.insert ?? `${f.name}(${f.name === 'TODAY' || f.name === 'NOW' ? ')' : ''}`)} className="flex w-full flex-col px-2.5 py-1.5 text-left hover:bg-surface-hover">
                      <span className="font-mono text-xs text-ink-900">{f.usage}</span><span className="text-xs text-ink-700">{f.words}</span>
                    </button></li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

/** the text with the place of the error marked */
function ErrorPlace({ text, at }: { text: string; at: number }) {
  const start = Math.max(0, at - 30)
  const end = Math.min(text.length, at + 30)
  return (
    <code className="w-fit rounded-sm border border-line bg-surface-subtle px-2 py-1 font-mono text-xs text-ink-900">
      {start > 0 ? '…' : ''}{text.slice(start, at)}<mark className="bg-danger-bg text-danger-text underline">{text.slice(at, at + 1) || ' '}</mark>{text.slice(at + 1, end)}{end < text.length ? '…' : ''}
    </code>
  )
}
