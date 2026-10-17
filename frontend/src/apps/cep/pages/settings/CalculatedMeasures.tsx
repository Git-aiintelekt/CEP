/**
 * The Calculated Measures section of Map a Dataset: one row per measure made from the others (Delivered ÷ Sent × 100 as a
 * percent), each a label, a left side, the operation, a right side (a measure or a number), a scale, a format and a
 * sensitivity. Report authors get it as a measure with the one calculation Calculated; the engine totals it exactly.
 */
import { Plus, X } from 'lucide-react'

import { Button, IconButton } from '@/components/Button'
import { Select, TextInput } from '@/components/Form'
import type { Aggregate, FormulaOp } from '@/apps/insights/types'
import { calcWords, NUMBER, newCalc, OP_WORDS, operandAggregate, operandChoice, type CalcRow, type MeasureChoice, type Operand } from './calculated'

const AGG_LABEL: Record<Exclude<Aggregate, 'calc'>, string> = { sum: 'Sum', count: 'Count', count_distinct: 'Distinct', avg: 'Average', min: 'Min', max: 'Max' }
const FORMAT_LABEL: Record<CalcRow['format'], string> = { percent: 'Percent', decimal: 'Decimal', integer: 'Whole number', money: 'Money' }
const SENS_LABEL = { NORMAL: 'Normal', PII: 'Personal', CONFIDENTIAL: 'Confidential' } as const
const control = '!mt-0 h-8'

export function CalculatedMeasures({ rows, measures, onChange, errors }: { rows: CalcRow[]; measures: MeasureChoice[]; onChange: (rows: CalcRow[]) => void; errors: string[] }) {
  const update = (index: number, patch: Partial<CalcRow>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  return (
    <section aria-label="Calculated measures" className="rounded-md border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle px-3 py-2">
        <h3 className="text-sm font-semibold text-ink-900">Calculated Measures</h3>
        <span className="text-xs text-ink-800">A rate, a share or a difference from the measures above, totalled exactly in every report. {rows.length === 0 ? 'None yet.' : `${rows.length} of up to 10.`}</span>
        <Button variant="secondary" size="sm" className="ml-auto" disabled={measures.length === 0 || rows.length >= 10} onClick={() => onChange([...rows, newCalc()])}><Plus size={14} strokeWidth={1.5} aria-hidden />Add a Calculated Measure</Button>
      </div>
      {measures.length === 0 && rows.length === 0 && <p className="px-3 py-2 text-xs text-ink-700">Mark at least one number as a measure first.</p>}
      {rows.length > 0 && (
        <table className="w-full text-sm" aria-label="Calculated measures">
          <thead><tr className="text-left text-xs font-semibold tracking-wide text-ink-800 uppercase"><th className="px-2 py-2">Label</th><th className="px-2 py-2">Formula</th><th className="px-2 py-2">Scale</th><th className="px-2 py-2">Format</th><th className="px-2 py-2">Sensitivity</th><th className="w-8" /></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-t border-line-subtle align-top">
                <td className="px-2 py-1.5">
                  <TextInput aria-label={`Calculated measure ${index + 1} label`} value={row.label} onChange={(e) => update(index, { label: e.target.value })} maxLength={100} placeholder="Delivered Rate" className={`${control} min-w-36`} />
                  <span className="mt-1 block font-mono text-[11px] text-ink-700">{calcWords(row, measures)}</span>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <OperandPicker label={`Calculated measure ${index + 1} left side`} operand={row.left} measures={measures} allowNumber={false} onChange={(left) => update(index, { left })} />
                    <span className="w-28"><Select aria-label={`Calculated measure ${index + 1} operation`} value={row.op} onChange={(e) => update(index, { op: e.target.value as FormulaOp })} className={control}>
                      {(Object.keys(OP_WORDS) as FormulaOp[]).map((op) => <option key={op} value={op}>{OP_WORDS[op]}</option>)}
                    </Select></span>
                    <OperandPicker label={`Calculated measure ${index + 1} right side`} operand={row.right} measures={measures} allowNumber onChange={(right) => update(index, { right })} />
                  </div>
                </td>
                <td className="px-2 py-1.5"><TextInput aria-label={`Calculated measure ${index + 1} scale`} type="number" step="any" value={row.scale} onChange={(e) => update(index, { scale: e.target.value })} placeholder="1" className={`${control} w-20`} /></td>
                <td className="px-2 py-1.5"><Select aria-label={`Calculated measure ${index + 1} format`} value={row.format} onChange={(e) => update(index, { format: e.target.value as CalcRow['format'] })} className={control}>
                  {(Object.keys(FORMAT_LABEL) as CalcRow['format'][]).map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
                </Select></td>
                <td className="px-2 py-1.5"><Select aria-label={`Calculated measure ${index + 1} sensitivity`} value={row.sensitivity} onChange={(e) => update(index, { sensitivity: e.target.value as CalcRow['sensitivity'] })} className={`${control} ${row.sensitivity !== 'NORMAL' ? '!border-warning-text' : ''}`}>
                  {(Object.keys(SENS_LABEL) as CalcRow['sensitivity'][]).map((s) => <option key={s} value={s}>{SENS_LABEL[s]}</option>)}
                </Select></td>
                <td className="px-1 py-1.5"><IconButton label={`Remove calculated measure ${index + 1}`} icon={X} size="xs" onClick={() => onChange(rows.filter((_, i) => i !== index))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {errors.length > 0 && <ul className="px-3 py-2 text-sm text-danger-text">{errors.map((message) => <li key={message}>{message}</li>)}</ul>}
      {rows.length > 0 && <p className="px-3 py-2 text-xs text-ink-800">A ratio with an empty denominator reads as empty, never as an error. Percent expects the scale 100; Money and the others expect none.</p>}
    </section>
  )
}

function OperandPicker({ label, operand, measures, allowNumber, onChange }: { label: string; operand: Operand; measures: MeasureChoice[]; allowNumber: boolean; onChange: (operand: Operand) => void }) {
  const choice = operandChoice(operand, measures)
  const measure = measures.find((item) => item.ref === choice)
  const aggregate = operandAggregate(operand)
  const unresolved = 'field' in operand && !measure
  return (
    <span className="inline-flex items-center gap-1">
      <span className="w-40"><Select aria-label={label} value={choice} onChange={(e) => {
        const next = e.target.value
        if (next === NUMBER) onChange({ value: '' })
        else {
          const picked = measures.find((item) => item.ref === next)
          onChange({ ref: next, aggregate: picked && aggregate && picked.aggregates.includes(aggregate) ? aggregate : picked?.aggregates[0] ?? 'sum' })
        }
      }} className={control}>
        <option value="">{unresolved ? `Field ${(operand as { field: string }).field}` : 'Choose a measure'}</option>
        {measures.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}
        {allowNumber && <option value={NUMBER}>A number…</option>}
      </Select></span>
      {'value' in operand ? (
        <TextInput aria-label={`${label} number`} type="number" step="any" value={operand.value} onChange={(e) => onChange({ value: e.target.value })} className={`${control} w-24`} />
      ) : measure && aggregate ? (
        <span className="w-28"><Select aria-label={`${label} calculation`} value={aggregate} onChange={(e) => onChange({ ...operand, aggregate: e.target.value as Aggregate })} className={control}>
          {measure.aggregates.filter((a): a is Exclude<Aggregate, 'calc'> => a !== 'calc').map((a) => <option key={a} value={a}>{AGG_LABEL[a]}</option>)}
        </Select></span>
      ) : null}
    </span>
  )
}
