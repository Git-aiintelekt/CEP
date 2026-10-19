/**
 * Shared Formulas: measures and formulas saved on a dataset, so every report on it reads one definition of Margin or Refund
 * Rate. Pick the dataset, then add, change or remove its formulas; a report administrator certifies the ones the workspace
 * should trust, and only a report administrator changes a certified one. A formula a report uses cannot be removed, and
 * renaming it asks first. Reports find them among the dataset's fields, a certified one with a tick.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, MoreHorizontal, Pencil, Plus, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { useAuth } from '@/auth/AuthContext'
import { iconButtonClass } from '@/components/buttonStyles'
import { Field, Select, buttonPrimary } from '@/components/Form'
import { MenuRow } from '@/components/MenuRow'
import { Notice } from '@/components/Notice'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { formatDateTime, formatNumber } from '@/lib/format'
import { insightsApi, keys, sharedFormulasApi } from '../api'
import { FORMAT_LABEL, SHARED_KIND_LABEL as KIND_LABEL } from '../editor/formulaHelp'
import { SharedFormulaDialog } from '../editor/SharedFormulaDialog'
import type { SharedFormula } from '../types'

export function SharedFormulasPage() {
  const { can } = useAuth()
  const toast = useToast()
  const client = useQueryClient()
  const builder = can('report.edit') || can('report.admin')
  const [params, setParams] = useSearchParams()
  const catalog = useQuery({ queryKey: keys.catalog, queryFn: ({ signal }) => insightsApi.catalog(signal) })
  const datasets = catalog.data?.datasets ?? []
  const datasetKey = params.get('dataset') && datasets.some((d) => d.key === params.get('dataset')) ? (params.get('dataset') as string) : datasets[0]?.key ?? ''
  const dataset = datasets.find((d) => d.key === datasetKey)
  const list = useQuery({ queryKey: keys.sharedFormulas(datasetKey), queryFn: ({ signal }) => sharedFormulasApi.list(datasetKey, signal), enabled: Boolean(datasetKey) })
  const [editing, setEditing] = useState<SharedFormula | 'new' | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const settle = () => { client.invalidateQueries({ queryKey: keys.sharedFormulas(datasetKey) }); client.invalidateQueries({ queryKey: keys.catalog }); client.invalidateQueries({ queryKey: ['insights', 'run'] }) }

  const certify = useMutation({
    mutationFn: (f: SharedFormula) => sharedFormulasApi.certify(datasetKey, f.id, !f.certified),
    onSuccess: (saved) => { settle(); toast.success(saved.certified ? 'Formula certified' : 'Certification removed', saved.label) },
    onError: (error) => toast.failure(error, 'The formula was not changed'),
  })
  const remove = useMutation({
    mutationFn: (f: SharedFormula) => sharedFormulasApi.remove(datasetKey, f.id),
    onSuccess: () => { settle(); toast.success('Formula removed') },
    onError: (error) => toast.failure(error, 'The formula was not removed'),
  })

  const rows = list.data?.formulas ?? []
  const canCertify = Boolean(list.data?.can_certify)
  const mayChange = (f: SharedFormula) => builder && (!f.certified || canCertify)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Shared Formulas" description="Measures and formulas saved on a dataset. Every report on it reads the same definition." help={<PageHelp chapter="insights" />}
        actions={builder && list.data?.ready && dataset ? <button type="button" className={buttonPrimary} onClick={() => setEditing('new')}><Plus size={16} strokeWidth={1.5} aria-hidden />Add a Formula</button> : undefined} />
      {catalog.isPending ? <Spinner label="Loading the datasets" /> : catalog.isError ? <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} /> : (
        <>
          <div className="w-full max-w-sm">
            <Field label="Dataset">{({ id }) => (
              <Select id={id} value={datasetKey} onChange={(e) => setParams({ dataset: e.target.value }, { replace: true })}>
                {datasets.map((d) => <option key={d.key} value={d.key}>{d.label}{d.component?.name ? ` · ${d.component.name}` : ''}</option>)}
              </Select>
            )}</Field>
          </div>
          {list.isPending ? <Spinner label="Loading the formulas" /> : list.isError ? <ErrorState error={list.error} onRetry={() => list.refetch()} /> : !list.data.ready ? (
            <Notice tone="warning" title="Not Available Yet">Shared formulas need a database update (patch 0065). Ask your administrator.</Notice>
          ) : rows.length === 0 ? (
            <p className="text-sm text-ink-800">No shared formulas on {dataset?.label ?? 'this dataset'} yet.{builder ? ' Add one, or share a report’s own formula from its Custom Fields.' : ''}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full text-sm" aria-label="Shared formulas">
                <thead>
                  <tr className="text-left text-xs font-semibold tracking-wide text-ink-800 uppercase">
                    <th className="px-3 py-2">Name</th><th className="px-3 py-2">Formula</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Certified</th><th className="px-3 py-2 text-right">Reports</th><th className="px-3 py-2">Changed</th><th className="w-10 px-1 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.id} className="border-t border-line-subtle align-top">
                      <td className="min-w-40 px-3 py-2"><span className="font-medium text-ink-900">{f.label}</span>{f.description && <span className="block text-xs text-ink-800">{f.description}</span>}</td>
                      <td className="max-w-md min-w-56 px-3 py-2"><code className="line-clamp-2 font-mono text-xs break-words text-ink-900" title={f.expression}>{f.expression}</code></td>
                      <td className="px-3 py-2 text-ink-800">{KIND_LABEL[f.kind]}{f.format ? ` · ${FORMAT_LABEL[f.format]}` : ''}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {f.certified ? (
                          <span className="inline-flex items-center gap-1 rounded-sm bg-success-bg px-1.5 py-0.5 text-xs font-semibold text-success-text" title={f.certified_at ? `${f.certified_by_name ?? 'A report administrator'}, ${formatDateTime(f.certified_at)}` : undefined}>
                            <BadgeCheck size={14} strokeWidth={1.5} aria-hidden />Certified
                          </span>
                        ) : <span className="text-xs text-ink-700">Not certified</span>}
                      </td>
                      <td className="cep-num px-3 py-2 text-right text-ink-800">{formatNumber(f.reports ?? 0)}</td>
                      <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{formatDateTime(f.updated_at)}</td>
                      <td className="relative px-1 py-1.5">
                        {(mayChange(f) || canCertify) && (
                          <>
                            <button type="button" aria-haspopup="menu" aria-expanded={menu === f.id} aria-label={`Actions for ${f.label}`} onClick={() => setMenu(menu === f.id ? null : f.id)} className={iconButtonClass({ pressed: menu === f.id })}>
                              <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden />
                            </button>
                            {menu === f.id && (
                              <div role="menu" className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-line bg-surface-overlay shadow-menu">
                                {mayChange(f) && <MenuRow role="menuitem" divider={false} leading={<Pencil size={16} strokeWidth={1.5} aria-hidden />} title="Edit" onClick={() => { setMenu(null); setEditing(f) }} />}
                                {canCertify && <MenuRow role="menuitem" divider={false} leading={f.certified ? <ShieldOff size={16} strokeWidth={1.5} aria-hidden /> : <ShieldCheck size={16} strokeWidth={1.5} aria-hidden />}
                                  title={f.certified ? 'Remove Certification' : 'Certify'} onClick={() => { setMenu(null); certify.mutate(f) }} />}
                                {mayChange(f) && <MenuRow role="menuitem" divider={false} leading={<Trash2 size={16} strokeWidth={1.5} aria-hidden />} title="Remove" disabled={(f.reports ?? 0) > 0}
                                  detail={(f.reports ?? 0) > 0 ? 'Reports use it' : undefined}
                                  onClick={() => { setMenu(null); if (window.confirm(`Remove “${f.label}” from ${dataset?.label ?? 'the dataset'}?`)) remove.mutate(f) }} />}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {editing && dataset && <SharedFormulaDialog dataset={dataset} formula={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { settle(); setEditing(null) }} />}
    </div>
  )
}
