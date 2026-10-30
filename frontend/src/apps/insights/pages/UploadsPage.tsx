/**
 * Uploaded Files (docs/mockups/insights-admin-pages.html): CSV and Excel files the workspace reports on. Upload a File opens
 * the two-step pop-up (choose the file, review its columns), and a file dropped anywhere on the page opens it already reading;
 * saved, it is a dataset like any other and New Report offers it. Search, Status and Used by Reports narrow the list (kept in
 * the address). Replace File puts new rows under the same columns, so the reports built on it read them straight away. A
 * file a report is built on cannot be deleted; its ⋯ says why.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FilePlus2, FileSpreadsheet, FileUp, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { ClearFiltersLink, FilterChip, SingleSelectMenu } from '@/components/FilterChip'
import { buttonPrimary } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { PageHeader } from '@/components/ResourceList'
import { SearchField } from '@/components/SearchField'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/auth/AuthContext'
import { formatDateTime, formatNumber } from '@/lib/format'
import { keys, uploadsApi } from '../api'
import { CountBadge } from '../components/CountBadge'
import { listCardClass, listHeadClass, listRowClass, useListParams } from '../components/listParams'
import { RowMenu } from '../components/RowMenu'
import { UploadFlow } from '../components/UploadFlow'
import type { UploadedFile } from '../types'

const ACCEPT = '.csv,.txt,.tsv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export function UploadsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const client = useQueryClient()
  const { can } = useAuth()
  const builder = can('report.edit') || can('report.admin')
  const [params, setParams] = useSearchParams()
  const files = useQuery({ queryKey: keys.uploads, queryFn: ({ signal }) => uploadsApi.list(signal) })
  const replacer = useRef<HTMLInputElement>(null)
  /** the upload pop-up: a new file (maybe dropped on the page), or Review Columns of one uploaded */
  const [flow, setFlow] = useState<{ file?: File; existing?: UploadedFile } | null>(() => (params.get('upload') === '1' ? {} : null))
  const [replacing, setReplacing] = useState<UploadedFile | null>(null)
  const [over, setOver] = useState(false)
  const list = useListParams(['q', 'status', 'used'] as const)
  const settle = () => { client.invalidateQueries({ queryKey: keys.uploads }); client.invalidateQueries({ queryKey: keys.catalog }) }

  const replace = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => uploadsApi.replace(id, file),
    onSuccess: (saved) => { settle(); client.invalidateQueries({ queryKey: ['insights', 'run'] }); toast.success('File replaced', `${saved.name} now has ${formatNumber(saved.row_count)} rows.`) },
    onError: (error) => toast.failure(error, 'The file was not replaced'),
  })
  const remove = useMutation({
    mutationFn: (id: string) => uploadsApi.remove(id),
    onSuccess: () => { settle(); toast.success('File deleted') },
    onError: (error) => toast.failure(error, 'The file was not deleted'),
  })
  const review = useMutation({ mutationFn: (id: string) => uploadsApi.get(id), onSuccess: (existing) => setFlow({ existing }), onError: (error) => toast.failure(error, 'The file could not be opened') })

  const ready = builder && Boolean(files.data?.ready)
  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')
  function dropped(event: DragEvent) {
    event.preventDefault()
    setOver(false)
    const file = event.dataTransfer.files[0]
    if (file && ready && !flow) setFlow({ file })
  }

  const all = files.data?.uploads ?? []
  const q = list.get('q').trim().toLowerCase()
  const rows = all.filter((f) => (!q || [f.name, f.file_name, f.description ?? ''].some((text) => text.toLowerCase().includes(q)))
    && (!list.get('status') || (list.get('status') === 'ready' ? f.status === 'READY' : f.status !== 'READY'))
    && (!list.get('used') || (list.get('used') === 'yes' ? (f.reports ?? 0) > 0 : (f.reports ?? 0) === 0)))
  // ?upload=1 (Create Report's Upload a File used to send people here) opens the pop-up once; the address is then tidied
  const asked = params.get('upload') === '1'
  useEffect(() => { if (asked) setParams({}, { replace: true }) }, [asked, setParams])
  const chipLabel = (key: 'status' | 'used', name: string, words: Record<string, string>) => (list.get(key) ? `${name}: ${words[list.get(key)]}` : name)

  return (
    <div className="relative flex flex-col gap-5" onDragOver={(event) => { if (ready && hasFiles(event)) { event.preventDefault(); setOver(true) } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false) }} onDrop={dropped}>
      {over && !flow && (
        <div aria-hidden className="pointer-events-none absolute -inset-3 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-brand-600 bg-brand-100/60">
          <span className="flex items-center gap-2 rounded-pill bg-surface px-4 py-2 text-sm font-semibold text-brand-800 shadow-menu"><FileUp size={16} strokeWidth={1.5} aria-hidden />Drop to upload the file</span>
        </div>
      )}
      <PageHeader title="Uploaded Files" description="CSV and Excel files to report on. Each one becomes a dataset." help={<><CountBadge count={files.data?.ready ? files.data.uploads.length : undefined} /><PageHelp chapter="insights" /></>}
        actions={ready ? <button type="button" className={buttonPrimary} onClick={() => setFlow({})}><Upload size={16} strokeWidth={1.5} aria-hidden />Upload a File</button> : undefined} />
      <input ref={replacer} type="file" accept={ACCEPT} className="hidden" aria-label="Choose the new file" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file && replacing) replace.mutate({ id: replacing.id, file }) }} />
      {files.isPending ? <Spinner label="Loading the files" /> : files.isError ? <ErrorState error={files.error} onRetry={() => files.refetch()} /> : !files.data.ready ? (
        <Notice tone="warning" title="Not Available Yet">Uploading files needs a database update (patch 0063). Ask your administrator.</Notice>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchField label="Search files" value={list.get('q')} onChange={(next) => list.set({ q: next })} />
            <FilterChip label={chipLabel('status', 'Status', { ready: 'Ready', review: 'Needs Review' })} active={Boolean(list.get('status'))} menuLabel="Status">
              {({ close }) => <SingleSelectMenu label="Status" value={list.get('status')} options={[{ value: '', label: 'Any Status' }, { value: 'ready', label: 'Ready' }, { value: 'review', label: 'Needs Review' }]} onChange={(value) => { list.set({ status: value }); close() }} />}
            </FilterChip>
            <FilterChip label={chipLabel('used', 'Used by Reports', { yes: 'Yes', no: 'No' })} active={Boolean(list.get('used'))} menuLabel="Used by Reports">
              {({ close }) => <SingleSelectMenu label="Used by Reports" value={list.get('used')} options={[{ value: '', label: 'Either' }, { value: 'yes', label: 'Used by a Report' }, { value: 'no', label: 'Not Used Yet' }]} onChange={(value) => { list.set({ used: value }); close() }} />}
            </FilterChip>
            {list.filtering && <ClearFiltersLink onClick={list.clear} />}
            {ready && <span className="ml-auto text-xs text-ink-800">Drop a CSV or Excel file anywhere here to upload it</span>}
          </div>
          {all.length === 0 ? (
            <EmptyState icon={FileSpreadsheet} title="No Files Yet" hint={builder ? 'Upload a CSV or Excel file to report on it, or drop one here.' : 'People who build reports can upload one.'}
              action={ready ? <button type="button" className={buttonPrimary} onClick={() => setFlow({})}><Upload size={16} strokeWidth={1.5} aria-hidden />Upload a File</button> : undefined} />
          ) : rows.length === 0 ? (
            <EmptyState icon={FileSpreadsheet} title="No Files Match These Filters" hint="Try another status, or clear the filters." action={<ClearFiltersLink onClick={list.clear} />} />
          ) : (
            <div className={listCardClass}>
              <table className="w-full text-sm" aria-label="Uploaded files">
                <thead>
                  <tr className={listHeadClass}>
                    <th className="px-3 py-2">Dataset</th><th className="px-3 py-2">File</th><th className="px-3 py-2 text-right">Rows</th><th className="px-3 py-2 text-right">Columns</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Reports</th><th className="px-3 py-2">Changed</th><th className="w-12 px-1 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((file) => (
                    <tr key={file.id} className={listRowClass}>
                      <td className="px-3 py-2"><span className="font-medium text-ink-900">{file.name}</span>{file.description && <span className="block text-xs text-ink-800">{file.description}</span>}</td>
                      <td className="px-3 py-2 text-ink-800">{file.file_name}</td>
                      <td className="cep-num px-3 py-2 text-right text-ink-800">{formatNumber(file.row_count)}</td>
                      <td className="cep-num px-3 py-2 text-right text-ink-800">{file.columns.length}</td>
                      <td className="px-3 py-2"><StatusBadge status={file.status} label={file.status === 'READY' ? 'Ready' : 'Needs Review'} /></td>
                      <td className="cep-num px-3 py-2 text-right text-ink-800">{file.reports ?? 0}</td>
                      <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{formatDateTime(file.replaced_at ?? file.updated_at)}</td>
                      <td className="px-1 py-1.5 text-right">
                        {builder && <RowMenu label={`Actions for ${file.name}`} groups={[
                          [
                            { title: file.status === 'READY' ? 'Review Columns' : 'Review and Save', icon: <FilePlus2 size={16} strokeWidth={1.5} aria-hidden />, onSelect: () => review.mutate(file.id) },
                            file.status === 'READY' && { title: 'New Report', icon: <FileSpreadsheet size={16} strokeWidth={1.5} aria-hidden />, onSelect: () => navigate(`/insights/reports/new?dataset=${file.key}`) },
                            { title: 'Replace File…', icon: <RefreshCw size={16} strokeWidth={1.5} aria-hidden />, onSelect: () => { setReplacing(file); window.setTimeout(() => replacer.current?.click(), 0) } },
                          ],
                          [{ title: 'Delete…', icon: <Trash2 size={16} strokeWidth={1.5} aria-hidden className="text-danger-text" />, tone: 'error', disabled: (file.reports ?? 0) > 0,
                            detail: (file.reports ?? 0) > 0 ? `${file.reports} ${file.reports === 1 ? 'report uses' : 'reports use'} it` : undefined,
                            onSelect: () => { if (window.confirm(`Delete “${file.name}” and its rows?`)) remove.mutate(file.id) } }],
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
      {flow && ready && <UploadFlow file={flow.file} existing={flow.existing} limits={files.data?.limits} onClose={() => { setFlow(null); settle() }}
        onSaved={(saved, firstTime) => { setFlow(null); settle(); if (firstTime) navigate(`/insights/reports/new?dataset=${saved.key}`) }} />}
    </div>
  )
}
