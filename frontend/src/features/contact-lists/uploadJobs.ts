/** List uploads run in the background: the workspace's uploads as the API reports them, and how to word them. */
import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import type { ListImport } from '@/lib/types'

/** how often a running upload is asked about; tests do not wait a second per step */
export const POLL_MS = import.meta.env.MODE === 'test' ? 30 : 1000
const FAST = POLL_MS * 2
const IDLE = import.meta.env.MODE === 'test' ? 200 : 30000

/** Uploads the operator is looking at right now (the wizard is open on them): no alert is raised for those. */
export const watchedUploads = new Set<string>()

/** The workspace's uploads, polled quickly while something is running and rarely otherwise. */
export function useImportJobs(enabled = true) {
  return useQuery({
    queryKey: ['contact-lists', 'imports'],
    queryFn: ({ signal }) => api.get<ListImport[]>('/contact-lists/imports/', undefined, signal),
    enabled,
    refetchInterval: (query) => ((query.state.data ?? []).some((job) => job.working) ? FAST : IDLE),
    refetchIntervalInBackground: false,
  })
}

export function jobSummary(job: ListImport): string {
  if (job.status === 'APPLIED') return `${formatNumber(job.applied_count)} contacts imported${job.review?.held_back ? ` · ${formatNumber(job.review.held_back)} rows skipped` : ''}`
  if (job.status === 'FAILED') return job.error ?? 'The upload failed.'
  if (job.status === 'CANCELLED') return 'Cancelled'
  if (job.status === 'REVIEW' && !job.working) return `${formatNumber(job.review?.ready ?? 0)} contacts ready · waiting for your review`
  if (job.status === 'STAGED' && !job.working) return `${formatNumber(job.row_count)} rows read · match the columns to continue`
  return job.working && job.progress.percent > 0 ? `${job.phase} · ${job.progress.percent}%` : job.phase
}

/** where "continue" leads for an upload that waits for the operator */
export function resumeLink(job: ListImport): string | null {
  return !job.working && (job.status === 'STAGED' || job.status === 'REVIEW') ? `/contact-lists/uploads?resume=${job.contact_list}:${job.id}` : null
}

export function uploadedWhen(job: ListImport): string {
  return `${formatDateTime(job.created_at)}${job.created_by_name ? ` · ${job.created_by_name}` : ''}`
}
