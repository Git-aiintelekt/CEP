/**
 * Shared Formulas (docs/mockups/insights-admin-pages.html): measures and formulas saved on a dataset, so every report on it
 * reads one definition of Margin or Refund Rate. The list shows every dataset's formulas, or one dataset's (the Dataset chip),
 * narrowed by search, Kind and Certified, all kept in the address. Add a Formula opens the two-step pop-up on the chosen
 * dataset; a report administrator certifies the ones the workspace should trust, and only a report administrator changes a
 * certified one. A formula a report uses cannot be removed; its ⋯ says why. Reports find them among the dataset's fields.
 */
import { useMutation, useQueries, useQueryClient, useQuery } from '@tanstack/react-query'
import { BadgeCheck, Pencil, Plus, ShieldCheck, ShieldOff, Sigma, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { useAuth } from '@/auth/AuthContext'
import { ClearFiltersLink, FilterChip, SingleSelectMenu } from '@/components/FilterChip'
import { filterChipClass } from '@/components/filterChipStyles'
import { buttonPrimary } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { PageHeader } from '@/components/ResourceList'
import { SearchField } from '@/components/SearchField'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { formatDateTime, formatNumber } from '@/lib/format'
import { insightsApi, keys, sharedFormulasApi } from '../api'
import { CountBadge } from '../components/CountBadge'
import { listCardClass, listHeadClass, listRowClass, useListParams } from '../components/listParams'
import { RowMenu } from '../components/RowMenu'
import { FORMAT_LABEL, SHARED_KIND_LABEL as KIND_LABEL } from '../editor/formulaHelp'
import { SharedFormulaDialog } from '../editor/SharedFormulaDialog'
import type { SharedFormula } from '../types'

const ICON = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const

export function SharedFormulasPage() {
  const { can } = useAuth()
  const toast = useToast()
  const client = useQueryClient()
  const builder = can('report.edit') || can('report.admin')
  const list = useListParams(['dataset', 'q', 'kind', 'certified'] as const)
  const catalog = useQuery({ queryKey: keys.catalog, queryFn: ({ signal }) => insightsApi.catalog(signal) })
  const datasets = catalog.data?.datasets ?? []
  const chosen = datasets.find((d) => d.key === list.get('dataset'))
  const shown = chosen ? [chosen] : datasets
  const lists = useQueries({ queries: shown.map((d) => ({ queryKey: keys.sharedFormulas(d.key), queryFn: ({ signal }: { signal: AbortSignal }) => sharedFormulasApi.list(d.key, signal) })) })
  const [editing, setEditing] = useState<SharedFormula | 'new' | null>(null)
  const settle = (datasetKey: string) => { client.invalidateQueries({ queryKey: keys.sharedFormulas(datasetKey) }); client.invalidateQueries({ queryKey: keys.catalog }); client.invalidateQueries({ queryKey: ['insights', 'run'] }) }

  const certify = useMutation({
    mutationFn: (f: SharedFormula) => sharedFormulasApi.certify(f.dataset_key, f.id, !f.certified),
    onSuccess: (saved) => { settle(saved.dataset_key); toast.success(saved.certified ? 'Formula certified' : 'Certification removed', saved.label) },
    onError: (error) => toast.failure(error, 'The formula was not changed'),
  })
  const remove = useMutation({
    mutationFn: (f: SharedFormula) => sharedFormulasApi.remove(f.dataset_key, f.id).then(() => f),
    onSuccess: (f) => { settle(f.dataset_key); toast.success('Formula removed') },
    onError: (error) => toast.failure(error, 'The formula was not removed'),
  })

  const pending = catalog.isPending || lists.some((q) => q.isPending)
  const failed = catalog.error ?? lists.find((q) => q.isError)?.error ?? null
  const ready = lists.length > 0 && lists.every((q) => q.data?.ready !== false)
  const canCertify = (datasetKey: string) => Boolean(lists[shown.findIndex((d) => d.key === datasetKey)]?.data?.can_certify)
  const all = lists.flatMap((q) => q.data?.formulas ?? [])
  const term = list.get('q').trim().toLowerCase()
  const rows = all.filter((f) => (!term || [f.label, f.description ?? '', f.expression].some((text) => text.toLowerCase().includes(term)))
    && (!list.get('kind') || f.kind === list.get('kind')) && (list.get('certified') !== '1' || f.certified))
  const labelOf = (key: string) => datasets.find((d) => d.key === key)?.label ?? key
  const mayChange = (f: SharedFormula) => builder && (!f.certified || canCertify(f.dataset_key))
  const certifiedOnly = list.get('certified') === '1'
  const kindLabel = list.get('kind') ? `Kind: ${KIND_LABEL[list.get('kind') as keyof typeof KIND_LABEL]}` : 'Kind'
  const startOn = chosen ?? datasets[0]

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Shared Formulas" description="Measures and formulas saved on a dataset. Every report on it reads the same definition."
        help={<><CountBadge count={!pending && ready ? all.length : undefined} /><PageHelp chapter="insights" /></>}
        actions={builder && ready && startOn ? <button type="button" className={buttonPrimary} onClick={() => setEditing('new')}><Plus {...ICON} />Add a Formula</button> : undefined} />
      {catalog.isPending ? <Spinner label="Loading the datasets" /> : catalog.isError ? <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchField label="Search formulas" value={list.get('q')} onChange={(next) => list.set({ q: next })} />
            <FilterChip label={chosen ? `Dataset: ${chosen.label}` : 'Dataset'} active={Boolean(chosen)} menuLabel="Dataset">
              {({ close }) => <SingleSelectMenu label="Dataset" value={chosen?.key ?? ''} options={[{ value: '', label: 'All Datasets' }, ...datasets.map((d) => ({ value: d.key, label: d.label }))]}
                onChange={(value) => { list.set({ dataset: value }); close() }} />}
            </FilterChip>
            <FilterChip label={kindLabel} active={Boolean(list.get('kind'))} menuLabel="Kind">
              {({ close }) => <SingleSelectMenu label="Kind" value={list.get('kind')} options={[{ value: '', label: 'Any Kind' }, ...(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))]}
                onChange={(value) => { list.set({ kind: value }); close() }} />}
            </FilterChip>
            <button type="button" aria-pressed={certifiedOnly} className={filterChipClass(certifiedOnly)} onClick={() => list.set({ certified: certifiedOnly ? '' : '1' })}>
              <BadgeCheck {...ICON} />Certified
            </button>
            {list.filtering && <ClearFiltersLink onClick={list.clear} />}
          </div>
          {pending ? <Spinner label="Loading the formulas" /> : failed ? <ErrorState error={failed} onRetry={() => lists.forEach((q) => q.refetch())} /> : !ready ? (
            <Notice tone="warning" title="Not Available Yet">Shared formulas need a database update (patch 0065). Ask your administrator.</Notice>
          ) : all.length === 0 ? (
            <EmptyState icon={Sigma} title={chosen ? `No Shared Formulas on ${chosen.label} Yet` : 'No Shared Formulas Yet'}
              hint={builder ? 'Add one, or share a report’s own formula from its Custom Fields.' : 'People who build reports can add them.'}
              action={builder && startOn ? <button type="button" className={buttonPrimary} onClick={() => setEditing('new')}><Plus {...ICON} />Add a Formula</button> : undefined} />
          ) : rows.length === 0 ? (
            <EmptyState icon={Sigma} title="No Formulas Match These Filters" hint="Try another kind or dataset, or clear the filters." action={<ClearFiltersLink onClick={list.clear} />} />
          ) : (
            <div className={listCardClass}>
              <table className="w-full text-sm" aria-label="Shared formulas">
                <thead>
                  <tr className={listHeadClass}>
                    <th className="px-3 py-2">Name</th><th className="px-3 py-2">Dataset</th><th className="px-3 py-2">Formula</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Certified</th><th className="px-3 py-2 text-right">Reports</th><th className="px-3 py-2">Changed</th><th className="w-12 px-1 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={`${f.dataset_key}:${f.id}`} className={`${listRowClass} align-top`}>
                      <td className="min-w-40 px-3 py-2"><span className="font-medium text-ink-900">{f.label}</span>{f.description && <span className="block text-xs text-ink-800">{f.description}</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-ink-800">{labelOf(f.dataset_key)}</td>
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
                      <td className="px-1 py-1.5 text-right">
                        {(mayChange(f) || canCertify(f.dataset_key)) && <RowMenu label={`Actions for ${f.label}`} groups={[
                          [
                            mayChange(f) && { title: 'Edit', icon: <Pencil {...ICON} />, onSelect: () => setEditing(f) },
                            canCertify(f.dataset_key) && { title: f.certified ? 'Remove Certification' : 'Certify', icon: f.certified ? <ShieldOff {...ICON} /> : <ShieldCheck {...ICON} />, onSelect: () => certify.mutate(f) },
                          ],
                          [mayChange(f) && { title: 'Remove…', icon: <Trash2 {...ICON} className="text-danger-text" />, tone: 'error', disabled: (f.reports ?? 0) > 0,
                            detail: (f.reports ?? 0) > 0 ? `${f.reports} ${f.reports === 1 ? 'report uses' : 'reports use'} it` : undefined,
                            onSelect: () => { if (window.confirm(`Remove “${f.label}” from ${labelOf(f.dataset_key)}?`)) remove.mutate(f) } }],
                        ]} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {editing && startOn && (
        <SharedFormulaDialog dataset={editing === 'new' ? startOn : datasets.find((d) => d.key === editing.dataset_key) ?? startOn} datasets={editing === 'new' ? datasets : undefined}
          formula={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={(saved) => { settle(saved.dataset_key); setEditing(null) }} />
      )}
    </div>
  )
}
