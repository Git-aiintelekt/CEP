/**
 * Uploaded Files: CSV and Excel files the workspace reports on. Upload one (choose it or drop it here), review its columns,
 * and it is a dataset like any other; New Report offers it. Replace File puts new rows under the same columns, so the reports
 * built on it read them straight away. A file a report is built on cannot be deleted.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FilePlus2, FileSpreadsheet, MoreHorizontal, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { iconButtonClass } from '@/components/buttonStyles'
import { buttonPrimary } from '@/components/Form'
import { MenuRow } from '@/components/MenuRow'
import { Notice } from '@/components/Notice'
import { PageHelp } from '@/apps/cep/help/HelpPanel'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/auth/AuthContext'
import { formatDateTime, formatNumber } from '@/lib/format'
import { keys, uploadsApi } from '../api'
import { UploadReviewDialog } from '../components/UploadReviewDialog'
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
  const chooser = useRef<HTMLInputElement>(null)
  const replacer = useRef<HTMLInputElement>(null)
  const [reviewing, setReviewing] = useState<UploadedFile | null>(null)
  const [replacing, setReplacing] = useState<UploadedFile | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const settle = () => { client.invalidateQueries({ queryKey: keys.uploads }); client.invalidateQueries({ queryKey: keys.catalog }) }

  const upload = useMutation({
    mutationFn: (file: File) => uploadsApi.upload(file),
    onSuccess: (made) => { settle(); setReviewing(made) },
    onError: (error) => toast.failure(error, 'The file was not read'),
  })
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
  const review = useMutation({ mutationFn: (id: string) => uploadsApi.get(id), onSuccess: setReviewing, onError: (error) => toast.failure(error, 'The file could not be opened') })

  function choose() { chooser.current?.click() }
  function dropped(event: DragEvent) {
    event.preventDefault()
    setOver(false)
    const file = event.dataTransfer.files[0]
    if (file && builder) upload.mutate(file)
  }

  const rows = files.data?.uploads ?? []
  const limits = files.data?.limits
  const limitWords = limits ? `Up to ${formatNumber(limits.rows)} rows, ${limits.columns} columns and ${Math.round(limits.bytes / 1048576)} MB.` : ''
  const asked = params.get('upload') === '1' && builder && Boolean(files.data?.ready)
  useEffect(() => { if (asked) { setParams({}, { replace: true }); chooser.current?.click() } }, [asked, setParams])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Uploaded Files" description="CSV and Excel files to report on. Each one becomes a dataset." help={<PageHelp chapter="insights" />}
        actions={builder && files.data?.ready ? <button type="button" className={buttonPrimary} onClick={choose} disabled={upload.isPending}><Upload size={16} strokeWidth={1.5} aria-hidden />Upload a File</button> : undefined} />
      <input ref={chooser} type="file" accept={ACCEPT} className="hidden" aria-label="Choose a file to upload" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) upload.mutate(file) }} />
      <input ref={replacer} type="file" accept={ACCEPT} className="hidden" aria-label="Choose the new file" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file && replacing) replace.mutate({ id: replacing.id, file }) }} />
      {files.isPending ? <Spinner label="Loading the files" /> : files.isError ? <ErrorState error={files.error} onRetry={() => files.refetch()} /> : !files.data.ready ? (
        <Notice tone="warning" title="Not Available Yet">Uploading files needs a database update (patch 0063). Ask your administrator.</Notice>
      ) : (
        <>
          {upload.isPending && <p role="status" className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Reading the file</p>}
          {builder && (
            <div onDragOver={(event) => { event.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={dropped}
              className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center ${over ? 'border-brand-600 bg-brand-100/40' : 'border-line-control bg-surface'}`}>
              <FileSpreadsheet size={24} strokeWidth={1.5} aria-hidden className="text-ink-700" />
              <p className="text-sm text-ink-900">Drop a CSV or Excel file here, or <button type="button" className="font-semibold text-brand-800 hover:underline" onClick={choose}>choose one</button>.</p>
              <p className="text-xs text-ink-800">The first row names the columns; an Excel file&apos;s first sheet is read. {limitWords}</p>
            </div>
          )}
          {rows.length === 0 ? (
            <p className="text-sm text-ink-800">No files yet.{builder ? '' : ' People who build reports can upload one.'}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-line bg-surface">
              <table className="w-full text-sm" aria-label="Uploaded files">
                <thead>
                  <tr className="text-left text-xs font-semibold tracking-wide text-ink-800 uppercase">
                    <th className="px-3 py-2">Dataset</th><th className="px-3 py-2">File</th><th className="px-3 py-2 text-right">Rows</th><th className="px-3 py-2 text-right">Columns</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Reports</th><th className="px-3 py-2">Changed</th><th className="w-10 px-1 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((file) => (
                    <tr key={file.id} className="border-t border-line-subtle">
                      <td className="px-3 py-2"><span className="font-medium text-ink-900">{file.name}</span>{file.description && <span className="block text-xs text-ink-800">{file.description}</span>}</td>
                      <td className="px-3 py-2 text-ink-800">{file.file_name}</td>
                      <td className="cep-num px-3 py-2 text-right text-ink-800">{formatNumber(file.row_count)}</td>
                      <td className="cep-num px-3 py-2 text-right text-ink-800">{file.columns.length}</td>
                      <td className="px-3 py-2"><StatusBadge status={file.status} label={file.status === 'READY' ? 'Ready' : 'Draft'} /></td>
                      <td className="cep-num px-3 py-2 text-right text-ink-800">{file.reports ?? 0}</td>
                      <td className="cep-num px-3 py-2 whitespace-nowrap text-ink-800">{formatDateTime(file.replaced_at ?? file.updated_at)}</td>
                      <td className="relative px-1 py-1.5">
                        {builder && (
                          <>
                            <button type="button" aria-haspopup="menu" aria-expanded={menu === file.id} aria-label={`Actions for ${file.name}`} onClick={() => setMenu(menu === file.id ? null : file.id)} className={iconButtonClass({ pressed: menu === file.id })}>
                              <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden />
                            </button>
                            {menu === file.id && (
                              <div role="menu" className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-line bg-surface-overlay shadow-menu">
                                <MenuRow role="menuitem" divider={false} leading={<FilePlus2 size={16} strokeWidth={1.5} aria-hidden />} title={file.status === 'READY' ? 'Review Columns' : 'Review and Save'} onClick={() => { setMenu(null); review.mutate(file.id) }} />
                                {file.status === 'READY' && <MenuRow role="menuitem" divider={false} leading={<FileSpreadsheet size={16} strokeWidth={1.5} aria-hidden />} title="New Report" onClick={() => navigate(`/insights/reports/new?dataset=${file.key}`)} />}
                                <MenuRow role="menuitem" divider={false} leading={<RefreshCw size={16} strokeWidth={1.5} aria-hidden />} title="Replace File" onClick={() => { setMenu(null); setReplacing(file); window.setTimeout(() => replacer.current?.click(), 0) }} />
                                <MenuRow role="menuitem" divider={false} leading={<Trash2 size={16} strokeWidth={1.5} aria-hidden />} title="Delete" disabled={(file.reports ?? 0) > 0}
                                  onClick={() => { setMenu(null); if (window.confirm(`Delete “${file.name}” and its rows?`)) remove.mutate(file.id) }} />
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
      {reviewing && <UploadReviewDialog upload={reviewing} onClose={() => setReviewing(null)} onSaved={(saved) => { setReviewing(null); if (reviewing.status !== 'READY') navigate(`/insights/reports/new?dataset=${saved.key}`) }} />}
    </div>
  )
}
