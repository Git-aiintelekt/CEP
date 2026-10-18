/**
 * Settings → Report Access: row access rules for Insights. A rule lets a person, or everyone holding a role, see only some
 * values of one field of a dataset (a store manager only their stores) in every report, dashboard, export and delivery.
 * People without a rule see every row of what they can open; rules on different fields all apply.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, User, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/Button'
import { Field, Select, TextInput, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { sharingApi } from '@/apps/insights/api'
import type { Principal, RowRule } from '@/apps/insights/types'

const RULES_KEY = ['insights', 'row-rules'] as const

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const t = window.setTimeout(() => setDebounced(value), ms); return () => window.clearTimeout(t) }, [value, ms])
  return debounced
}

export function ReportAccessPage() {
  const toast = useToast()
  const client = useQueryClient()
  const rules = useQuery({ queryKey: RULES_KEY, queryFn: () => sharingApi.rowRules() })
  const [editing, setEditing] = useState<RowRule | 'new' | null>(null)
  const remove = useMutation({
    mutationFn: (rule: RowRule) => sharingApi.deleteRowRule(rule.id),
    onSuccess: () => { toast.success('The rule was removed'); void client.invalidateQueries({ queryKey: RULES_KEY }) },
    onError: (error) => toast.failure(error, 'The rule was not removed'),
  })

  if (rules.isPending) return <p className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Loading</p>
  if (rules.isError) return <ErrorState title="The rules could not be loaded" error={rules.error} onRetry={() => void rules.refetch()} />
  const list = rules.data.rules
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-section-title font-semibold text-ink-900">Report Access</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-ink-800">Limit which rows a person or a role sees in Insights: only some values of one field, such as a store manager seeing only their stores. It applies to every report, dashboard, export and delivery. People without a rule see every row of what they can open.</p>
        </div>
        <Button onClick={() => setEditing('new')}><Plus size={16} strokeWidth={1.5} aria-hidden />Add a Rule</Button>
      </div>
      {list.length === 0 ? (
        <EmptyState title="No rule yet" hint="Everyone sees every row of the reports and dashboards they can open. Add a rule to limit a person or a role to some values of a field." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full text-sm" aria-label="Rules">
            <thead><tr className="text-left text-xs font-semibold tracking-wide text-ink-800 uppercase"><th className="px-3 py-2">Who</th><th className="px-3 py-2">Dataset</th><th className="px-3 py-2">Sees Only</th><th className="px-3 py-2">Changed</th><th className="w-40 px-3 py-2" /></tr></thead>
            <tbody>
              {list.map((rule) => (
                <tr key={rule.id} className="border-t border-line-subtle align-top">
                  <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5 text-ink-900">{rule.principal.kind === 'role' ? <Users size={14} strokeWidth={1.5} aria-hidden className="text-ink-700" /> : <User size={14} strokeWidth={1.5} aria-hidden className="text-ink-700" />}{rule.principal.name}</span>
                    <span className="block text-xs text-ink-700">{rule.principal.kind === 'role' ? `Role · ${rule.principal.detail}` : rule.principal.detail}</span></td>
                  <td className="px-3 py-2 text-ink-900">{rule.dataset_label}</td>
                  <td className="px-3 py-2"><span className="text-ink-900">{rule.field_label}: {rule.values.map(String).join(', ')}</span>
                    {rule.broken && <span className="block text-xs text-danger-text">The dataset no longer offers this field: the person's reports on it are refused until the rule is changed.</span>}
                    {rule.note && <span className="block text-xs text-ink-700">{rule.note}</span>}</td>
                  <td className="px-3 py-2 text-xs text-ink-800">{formatDateTime(rule.updated_at)}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className="mr-3 text-sm font-semibold text-brand-800 hover:underline" onClick={() => setEditing(rule)}>Edit</button>
                    <button type="button" className="text-sm font-semibold text-danger-text hover:underline" disabled={remove.isPending}
                      onClick={() => { if (window.confirm(`Remove the rule for ${rule.principal.name} on ${rule.field_label}? They will see every row again.`)) remove.mutate(rule) }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <RuleDialog rule={editing === 'new' ? null : editing} datasets={rules.data.datasets} onClose={() => setEditing(null)} />}
    </div>
  )
}

function RuleDialog({ rule, datasets, onClose }: { rule: RowRule | null; datasets: { key: string; label: string; fields: { key: string; label: string; type: string }[] }[]; onClose: () => void }) {
  const toast = useToast()
  const client = useQueryClient()
  const [who, setWho] = useState<Principal | null>(rule?.principal ?? null)
  const [dataset, setDataset] = useState(rule?.dataset ?? datasets[0]?.key ?? '')
  const [field, setField] = useState(rule?.field ?? '')
  const [values, setValues] = useState((rule?.values ?? []).map(String).join('\n'))
  const [note, setNote] = useState(rule?.note ?? '')
  const [q, setQ] = useState('')
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const term = useDebounced(q.trim(), 250)
  const found = useQuery({ queryKey: ['insights', 'principals', term], queryFn: () => sharingApi.principals(term), enabled: !who && term.length > 0 })
  const fields = datasets.find((d) => d.key === dataset)?.fields ?? []
  const list = values.split(/[\n,]/).map((v) => v.trim()).filter(Boolean)
  const save = useMutation({
    mutationFn: () => {
      const body = { dataset, field, principal: who ? { kind: who.kind, id: who.id } : null, values: list, note: note.trim() }
      return rule ? sharingApi.updateRowRule(rule.id, { ...body, row_version: rule.row_version }) : sharingApi.createRowRule(body)
    },
    onSuccess: () => { toast.success(rule ? 'The rule was saved' : 'The rule was added'); void client.invalidateQueries({ queryKey: RULES_KEY }); onClose() },
    onError: (error) => { setErrors(error instanceof ApiError ? error.fieldErrors : {}); toast.failure(error, 'The rule was not saved') },
  })
  return (
    <Modal title={rule ? 'Change a Rule' : 'Add a Rule'} subtitle="A person or a role sees only these values of one field" onClose={onClose} size="picker"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} disabled={save.isPending || !who || !field || list.length === 0} onClick={() => save.mutate()}>{rule ? 'Save' : 'Add Rule'}</button>
        </div>
      )}>
      <div className="flex flex-col gap-3">
        <Field label="Who" required error={errors.principal}>{() => who ? (
          <span className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm">
            {who.kind === 'role' ? <Users size={14} strokeWidth={1.5} aria-hidden className="text-ink-700" /> : <User size={14} strokeWidth={1.5} aria-hidden className="text-ink-700" />}
            <span className="min-w-0 flex-1 truncate text-ink-900">{who.name}</span>
            <button type="button" className="text-xs font-semibold text-brand-800 hover:underline" onClick={() => setWho(null)}>Change</button>
          </span>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="relative">
              <span className="sr-only">Find a person or a role</span>
              <Search size={16} strokeWidth={1.5} aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-700" />
              <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Find a person or a role"
                className="h-8 w-full rounded-control-md border border-transparent bg-surface-sunken pr-3 pl-8 text-sm text-ink-900 placeholder:text-ink-700 focus:bg-surface focus-visible:border-focus focus-visible:outline-none" />
            </label>
            {term && (
              <ul aria-label="People and roles found" className="max-h-40 overflow-y-auto rounded-md border border-line">
                {found.isPending ? <li className="p-2"><Spinner size="sm" label="Looking" /></li> : [...(found.data?.roles ?? []), ...(found.data?.people ?? [])].map((p) => (
                  <li key={`${p.kind}:${p.id}`}><button type="button" onClick={() => setWho(p)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-hover">
                    {p.kind === 'role' ? <Users size={14} strokeWidth={1.5} aria-hidden className="text-ink-700" /> : <User size={14} strokeWidth={1.5} aria-hidden className="text-ink-700" />}
                    <span className="min-w-0 flex-1 truncate text-ink-900">{p.name}</span><span className="text-xs text-ink-700">{p.kind === 'role' ? `Role · ${p.detail}` : p.detail}</span>
                  </button></li>
                ))}
              </ul>
            )}
          </div>
        )}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dataset" required error={errors.dataset}>{({ id, describedBy }) => (
            <Select id={id} describedBy={describedBy} value={dataset} onChange={(event) => { setDataset(event.target.value); setField('') }}>
              {datasets.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </Select>
          )}</Field>
          <Field label="Field" required error={errors.field}>{({ id, describedBy }) => (
            <Select id={id} describedBy={describedBy} value={field} onChange={(event) => setField(event.target.value)}>
              <option value="">Choose a field</option>
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </Select>
          )}</Field>
        </div>
        <Field label="Sees Only" required error={errors.values} hint="One value per line, or separated by commas, written as the reports show them.">{({ id, describedBy, invalid }) => (
          <textarea id={id} aria-describedby={describedBy} aria-invalid={invalid} value={values} onChange={(event) => setValues(event.target.value)} rows={4}
            className="w-full rounded-control-md border border-line-control bg-surface px-3 py-2 text-sm text-ink-900 focus:border-focus focus:outline-none" />
        )}</Field>
        <Field label="Note" error={errors.note}>{({ id, describedBy }) => <TextInput id={id} describedBy={describedBy} value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="Why, for whoever reads this later" />}</Field>
      </div>
    </Modal>
  )
}
