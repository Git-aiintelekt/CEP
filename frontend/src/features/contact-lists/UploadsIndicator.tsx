/**
 * List uploads run in the background (the API reads, checks and imports a file as jobs, a few at a time). This module is
 * how the operator sees them: a header button with what is running, an alert when one finishes, and the uploads page.
 */
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CircleAlert, UploadCloud, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { iconButtonClass } from '@/components/buttonStyles'
import { useAuth } from '@/auth/AuthContext'
import type { ListImport } from '@/lib/types'

import { jobSummary, resumeLink, useImportJobs, watchedUploads } from './uploadJobs'

export function ProgressBar({ job, className = '' }: { job: Pick<ListImport, 'progress' | 'working' | 'status' | 'phase'>; className?: string }) {
  const failed = job.status === 'FAILED' || job.status === 'CANCELLED'
  const percent = job.working ? job.progress.percent : failed ? 0 : 100
  return (
    <div className={className}>
      <div role="progressbar" aria-label={job.phase} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 w-full overflow-hidden rounded-full bg-fill-subtle">
        <div className={`h-full rounded-full transition-[width] duration-500 ${failed ? 'bg-danger' : job.working ? 'bg-brand-600' : 'bg-success'}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

interface Toast {
  id: string
  tone: 'success' | 'danger' | 'info'
  title: string
  text: string
  to: string
  action: string
}

/** Header button: how many uploads are running, the latest ones, and an alert when one finishes or needs the operator. */
export function UploadsIndicator() {
  const { can } = useAuth()
  const allowed = can('list.view') || can('list.edit')
  const jobs = useImportJobs(allowed)
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const seen = useRef<Map<string, string> | null>(null)
  const box = useRef<HTMLDivElement>(null)

  // Every answer of the uploads poll is compared with the one before: an upload that stopped being worked on is news.
  // Subscribed to the query cache, so the alert is raised by the event (a poll came back), not by a render.
  useEffect(() => {
    const state = (job: ListImport) => `${job.status}:${job.working ? 'working' : 'idle'}`
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success' || event.query.queryKey[0] !== 'contact-lists' || event.query.queryKey[1] !== 'imports') return
      const data = (event.query.state.data ?? []) as ListImport[]
      const before = seen.current
      seen.current = new Map(data.map((job) => [job.id, state(job)]))
      if (!before) return                                 // the first answer is the starting point, not news
      const news: Toast[] = []
      for (const job of data) {
        const was = before.get(job.id)
        if (was === state(job) || !was?.endsWith(':working') || watchedUploads.has(job.id)) continue      // the wizard is open on it: they can see it
        if (job.status === 'APPLIED') news.push({ id: job.id, tone: 'success', title: `“${job.list_name}” is ready`, text: jobSummary(job), to: `/contact-lists/${job.contact_list}`, action: 'Open the List' })
        else if (job.status === 'FAILED') news.push({ id: job.id, tone: 'danger', title: `The upload for “${job.list_name}” failed`, text: jobSummary(job), to: '/contact-lists/uploads', action: 'See Uploads' })
        else if (job.status === 'REVIEW' && !job.working) news.push({ id: job.id, tone: 'info', title: `“${job.file_name}” has been checked`, text: jobSummary(job), to: resumeLink(job) ?? '/contact-lists/uploads', action: 'Review It' })
      }
      if (news.length === 0) return
      setToasts((current) => [...current.filter((toast) => !news.some((item) => item.id === toast.id)), ...news].slice(-4))
      void queryClient.invalidateQueries({ queryKey: ['contact-lists'], predicate: (query) => query.queryKey[1] !== 'imports' && query.queryKey[1] !== 'import' })
    })
  }, [queryClient])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  if (!allowed) return null
  const all = jobs.data ?? []
  const running = all.filter((job) => job.working).length
  const waiting = all.filter((job) => resumeLink(job)).length
  const label = running > 0 ? `List Uploads: ${running} in progress` : waiting > 0 ? `List Uploads: ${waiting} waiting for you` : 'List Uploads'

  return (
    <div ref={box} className="relative">
      <button type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} title={label} onClick={() => setOpen((value) => !value)}
        className={`${iconButtonClass({ pressed: open })} relative`}>
        <UploadCloud size={20} strokeWidth={1.5} aria-hidden />
        {(running > 0 || waiting > 0) && (
          <span aria-hidden className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ${running > 0 ? 'bg-brand-600' : 'bg-warning'}`}>
            {running || waiting}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="List Uploads" className="absolute right-0 z-30 mt-2 w-80 rounded-md border border-line bg-surface shadow-menu">
          <p className="border-b border-line px-3 py-2 text-sm font-semibold text-ink-900">List Uploads</p>
          {all.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-800">No file has been uploaded yet.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-line-subtle overflow-y-auto">
              {all.slice(0, 6).map((job) => (
                <li key={job.id} className="px-3 py-2">
                  <p className="truncate text-sm font-medium text-ink-900">{job.list_name}</p>
                  <p className="truncate text-xs text-ink-800">{job.file_name} · {jobSummary(job)}</p>
                  {job.working && <ProgressBar job={job} className="mt-1.5" />}
                  {resumeLink(job) && <Link to={resumeLink(job) as string} onClick={() => setOpen(false)} className="mt-1 inline-block text-xs font-semibold text-brand-800 hover:underline">Continue →</Link>}
                </li>
              ))}
            </ul>
          )}
          <Link to="/contact-lists/uploads" onClick={() => setOpen(false)} className="block border-t border-line px-3 py-2 text-center text-sm font-medium text-brand-800 hover:bg-surface-subtle">See All Uploads</Link>
        </div>
      )}

      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <div key={toast.id} role="status" className="pointer-events-auto flex items-start gap-2 rounded-lg border border-line bg-surface p-3 shadow-toast">
            <span className={`mt-0.5 ${toast.tone === 'danger' ? 'text-danger-text' : toast.tone === 'success' ? 'text-success-text' : 'text-callout-icon'}`}>
              {toast.tone === 'danger' ? <CircleAlert size={18} strokeWidth={1.5} aria-hidden /> : <CheckCircle2 size={18} strokeWidth={1.5} aria-hidden />}
            </span>
            <div className="min-w-0 grow">
              <p className="text-sm font-semibold text-ink-900">{toast.title}</p>
              <p className="text-xs text-ink-800">{toast.text}</p>
              <Link to={toast.to} onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} className="mt-1 inline-block text-xs font-semibold text-brand-800 hover:underline">{toast.action} →</Link>
            </div>
            <button type="button" aria-label="Dismiss" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} className={iconButtonClass({ size: 'xs' })}>
              <X size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
