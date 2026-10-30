/**
 * Insights → Usage (docs/mockups/insights-admin-pages.html), for report administrators: which reports and dashboards are
 * opened, by how many people, how often through an embed link, and who opens the most, over 7, 30 or 90 days. Every name says
 * where it lives (its folder and owner), so two reports of one name can be told apart. Nobody Opened lists the reports no one
 * opened in the period, each with a ⋯ to open, file or delete it. Opening the same item again within ten minutes counts once.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FolderInput, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { BarList } from '@/components/charts/BarList'
import { ClearFiltersLink, SelectFilter } from '@/components/FilterChip'
import { Modal } from '@/components/Modal'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { Tabs } from '@/components/Tabs'
import { useToast } from '@/components/Toast'
import { formatDateTime, formatNumber } from '@/lib/format'
import { insightsApi, usageApi, useDashboards, useDeleteReport, useFolders, useReports } from '../api'
import { FolderSelect } from '../components/FolderSelect'
import { listCardClass, listHeadClass, listRowClass, useListParams } from '../components/listParams'
import { RowMenu } from '../components/RowMenu'

const num = 'cep-num px-3 py-2 text-right text-ink-800'
const ICON = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const
const PERIODS: { value: '7' | '30' | '90'; label: string }[] = [{ value: '7', label: '7 Days' }, { value: '30', label: '30 Days' }, { value: '90', label: '90 Days' }]
const KINDS: { value: '' | 'report' | 'dashboard'; label: string }[] = [{ value: '', label: 'Reports and Dashboards' }, { value: 'report', label: 'Reports' }, { value: 'dashboard', label: 'Dashboards' }]

export function UsagePage() {
  const navigate = useNavigate()
  const toast = useToast()
  const client = useQueryClient()
  const list = useListParams(['days', 'kind', 'tab'] as const, { days: '30' })
  const days: '7' | '30' | '90' = list.get('days') === '7' ? '7' : list.get('days') === '90' ? '90' : '30'
  const kind = list.get('kind') === 'report' || list.get('kind') === 'dashboard' ? list.get('kind') : ''
  const tab = list.get('tab') === 'unopened' ? 'unopened' : 'all'
  const usage = useQuery({ queryKey: ['insights', 'usage', days], queryFn: ({ signal }) => usageApi.report(Number(days), signal), placeholderData: (previous) => previous })
  const reports = useReports({})
  const dashboards = useDashboards()
  const folders = useFolders()
  const remove = useDeleteReport()
  const [filing, setFiling] = useState<{ id: string; name: string; folder: string | null } | null>(null)
  const fileIn = useMutation({
    mutationFn: async ({ id, folderId }: { id: string; folderId: string | null }) => {
      const full = await insightsApi.report(id)
      return insightsApi.update(id, { row_version: full.row_version, folder_id: folderId })
    },
    onSuccess: () => { setFiling(null); client.invalidateQueries({ queryKey: ['insights', 'reports'] }); toast.success('Moved') },
    onError: (error) => toast.failure(error, 'The report was not moved'),
  })

  const report = (id: string) => reports.data?.reports.find((r) => r.id === id)
  const folderName = (id: string | null | undefined) => (id ? folders.data?.folders.find((f) => f.id === id)?.name : undefined) ?? 'No Folder'
  const where = (itemKind: 'report' | 'dashboard', id: string, owner?: string | null) => {
    if (itemKind === 'dashboard') return ['Dashboards', dashboards.data?.dashboards.find((d) => d.id === id)?.owner_name ?? owner].filter(Boolean).join(' · ')
    const r = report(id)
    return [folderName(r?.folder_id), r?.owner_name ?? owner, r?.dataset_label].filter(Boolean).join(' · ')
  }
  /** for a name that still repeats with its place: when each was changed */
  const changed = (itemKind: 'report' | 'dashboard', id: string) => {
    const at = itemKind === 'report' ? report(id)?.updated_at : dashboards.data?.dashboards.find((d) => d.id === id)?.updated_at
    return at ? `changed ${formatDateTime(at)}` : ''
  }
  const data = usage.data
  const items = (data?.items ?? []).filter((item) => !kind || item.kind === kind)
  const unopened = data?.unopened ?? []
  const total = data ? data.daily.reduce((sum, day) => sum + day.opens, 0) : 0
  const dup = (name: string) => items.filter((item) => item.name === name).length > 1
  const twin = (item: (typeof items)[number]) => items.filter((other) => other.name === item.name && where(other.kind, other.item_id) === where(item.kind, item.item_id)).length > 1
  const label = (item: (typeof items)[number]) => (dup(item.name) ? [item.name, where(item.kind, item.item_id), twin(item) ? changed(item.kind, item.item_id) : ''].filter(Boolean).join(' · ') : item.name)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Usage" description="What people open, and what nobody opens." help={<PageHelp chapter="insights" />} />
      <div className="flex flex-wrap items-center gap-2">
        <SelectFilter label="Period" options={PERIODS} value={days} defaultValue="30" showValue onChange={(next) => list.set({ days: next })} />
        <SelectFilter label="Kind" options={KINDS} value={kind as '' | 'report' | 'dashboard'} onChange={(next) => list.set({ kind: next })} />
        {(list.get('kind') || days !== '30') && <ClearFiltersLink onClick={() => list.set({ days: '', kind: '' })} />}
        {data?.ready && <span className="ml-auto text-xs text-ink-800">{formatNumber(total)} opening{total === 1 ? '' : 's'} in the last {days} days · opening the same thing again within ten minutes counts once</span>}
      </div>
      {usage.isPending ? <Spinner label="Loading the usage" /> : usage.isError ? <ErrorState error={usage.error} onRetry={() => usage.refetch()} /> : !usage.data.ready ? (
        <EmptyState title="Usage Starts With Patch 0061" hint="Openings are counted once database patch 0061 is applied to this workspace." />
      ) : (
        <>
          {items.length > 0 && (
            <div className="grid gap-5 lg:grid-cols-2">
              <section aria-label="Most opened" className="flex flex-col gap-3 rounded-lg border border-line p-4">
                <h2 className="text-sm font-semibold text-ink-900">Most Opened</h2>
                <BarList title="Openings by report and dashboard" rows={items.slice(0, 8).map((item) => ({ key: `${item.kind}-${item.item_id}`, label: label(item), value: item.opens }))} formatValue={formatNumber} />
              </section>
              <section aria-label="Who opens" className="flex flex-col gap-3 rounded-lg border border-line p-4">
                <h2 className="text-sm font-semibold text-ink-900">Who Opens the Most</h2>
                <BarList title="Openings by person" rows={usage.data.people.slice(0, 8).map((person) => ({ key: person.user_id, label: person.name, value: person.opens }))} formatValue={formatNumber} />
              </section>
            </div>
          )}
          <div className="flex overflow-x-auto border-b border-line">
            <Tabs label="Usage" idPrefix="usage" value={tab} onChange={(next) => list.set({ tab: next === 'unopened' ? 'unopened' : '' })}
              tabs={[{ id: 'all', label: 'All Openings', count: items.length }, { id: 'unopened', label: 'Nobody Opened', count: unopened.length }]} />
          </div>
          {tab === 'all' ? (items.length === 0 ? (
            <EmptyState title="Nothing Opened in This Period" hint="Openings of reports and dashboards show up here." />
          ) : (
            <div className={listCardClass}>
              <table className="w-full text-sm" aria-label="Openings">
                <thead>
                  <tr className={listHeadClass}>
                    <th className="px-3 py-2">Report or Dashboard</th><th className="px-3 py-2">Where</th><th className="px-3 py-2 text-right">Openings</th><th className="px-3 py-2 text-right">People</th>
                    <th className="px-3 py-2 text-right">Through Embeds</th><th className="px-3 py-2">Last Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={`${item.kind}-${item.item_id}`} className={listRowClass}>
                      <td className="px-3 py-2">
                        <Link to={`/insights/${item.kind === 'report' ? 'reports' : 'dashboards'}/${item.item_id}`} className="font-medium text-ink-900 hover:underline">{item.name}</Link>
                        <span className="block text-xs text-ink-800">{item.kind === 'report' ? 'Report' : 'Dashboard'}{twin(item) ? ` · ${changed(item.kind, item.item_id)}` : ''}</span>
                      </td>
                      <td className="px-3 py-2 text-ink-800">{where(item.kind, item.item_id)}</td>
                      <td className={num}>{formatNumber(item.opens)}</td>
                      <td className={num}>{formatNumber(item.people)}</td>
                      <td className={num}>{formatNumber(item.embedded)}</td>
                      <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{formatDateTime(item.last_opened)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )) : unopened.length === 0 ? (
            <EmptyState title="Every Report Was Opened" hint={`Each report was opened at least once in the last ${days} days.`} />
          ) : (
            <div className={listCardClass}>
              <table className="w-full text-sm" aria-label={`Reports nobody opened in ${days} days`}>
                <thead>
                  <tr className={listHeadClass}>
                    <th className="px-3 py-2">Report</th><th className="px-3 py-2">Where</th><th className="px-3 py-2">Last Changed</th><th className="w-12 px-1 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {unopened.map((r) => {
                    const full = report(r.id)
                    return (
                      <tr key={r.id} className={listRowClass}>
                        <td className="px-3 py-2"><Link to={`/insights/reports/${r.id}`} className="font-medium text-ink-900 hover:underline">{r.name}</Link></td>
                        <td className="px-3 py-2 text-ink-800">{where('report', r.id, r.owner_name)}</td>
                        <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{formatDateTime(r.updated_at)}</td>
                        <td className="px-1 py-1.5 text-right">
                          <RowMenu label={`Actions for ${r.name}`} groups={[
                            [
                              { title: 'Open', icon: <ExternalLink {...ICON} />, onSelect: () => navigate(`/insights/reports/${r.id}`) },
                              full?.can_edit !== false && { title: 'Move to Folder…', icon: <FolderInput {...ICON} />, onSelect: () => setFiling({ id: r.id, name: r.name, folder: full?.folder_id ?? null }) },
                            ],
                            [full?.can_edit !== false && { title: 'Delete…', icon: <Trash2 {...ICON} className="text-danger-text" />, tone: 'error', disabled: remove.isPending,
                              onSelect: () => { if (window.confirm(`Delete “${r.name}”? Its versions go with it.`)) remove.mutate(r.id, { onSuccess: () => void usage.refetch(), onError: (error) => toast.failure(error, 'The report was not deleted') }) } }],
                          ]} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {filing && (
        <Modal title="Move to Folder" onClose={() => setFiling(null)}>
          <p className="mb-3 text-sm text-ink-800">Choose where “{filing.name}” is filed.</p>
          <FolderSelect value={filing.folder} disabled={fileIn.isPending} onChange={(folderId) => fileIn.mutate({ id: filing.id, folderId })} />
        </Modal>
      )}
    </div>
  )
}
