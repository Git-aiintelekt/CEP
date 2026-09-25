/** The workspace's list uploads: what is running, what waits for someone, what finished or failed. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { PageHeader } from '@/components/ResourceList'
import { EmptyState, ErrorState, Spinner } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import type { ListImport } from '@/lib/types'

import { CreateListWizard } from './CreateListWizard'
import { problemText } from './problem'
import { jobSummary, resumeLink, uploadedWhen, useImportJobs } from './uploadJobs'
import { UploadReport } from './UploadReport'
import { ProgressBar } from './UploadsIndicator'

const TONE: Record<string, string> = { APPLIED: 'COMPLETED', FAILED: 'FAILED', CANCELLED: 'CANCELLED', REVIEW: 'PAUSED', STAGED: 'PAUSED' }

export function UploadsPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [notice, setNotice] = useState('')
  const [reportOf, setReportOf] = useState<string | null>(null)
  const jobs = useImportJobs()
  const [listId, importId] = (params.get('resume') ?? '').split(':')
  const canImport = can('list.import') || can('list.edit')

  const cancel = useMutation({
    mutationFn: (job: ListImport) => api.post<ListImport>(`/contact-lists/${job.contact_list}/imports/${job.id}/cancel/`),
    onSuccess: (job) => {
      setNotice(`The upload of “${job.file_name}” was cancelled.`)
      void queryClient.invalidateQueries({ queryKey: ['contact-lists'] })
    },
    onError: (error) => setNotice(problemText(error)),
  })

  const rows = jobs.data ?? []
  return (
    <section>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-ink-500">
        <Link to="/contact-lists" className="font-medium text-brand-800 hover:underline">Contact Lists</Link> <span aria-hidden>/</span> Uploads
      </nav>
      <PageHeader
        title="List Uploads"
        description="Files are read, checked and imported in the background, a few at a time and one per workspace, so a large list never slows CEP down. You can leave this page: you get an alert when an upload is done."
      />
      {notice && <p role="status" className="mb-4 rounded-sm border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-900">{notice}</p>}

      {jobs.isError ? (
        <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
      ) : jobs.isPending ? (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-5 py-10 text-sm text-ink-500"><Spinner /> Loading uploads</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No uploads yet" hint="Create a list from a file and it shows up here while it is being processed." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">List Uploads</caption>
            <thead className="border-b border-line bg-surface-subtle text-xs font-semibold text-ink-700">
              <tr>
                <th scope="col" className="px-3 py-2">List and File</th>
                <th scope="col" className="px-3 py-2">Status</th>
                <th scope="col" className="w-56 px-3 py-2">Progress</th>
                <th scope="col" className="px-3 py-2">Uploaded</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {rows.map((job) => {
                const resume = resumeLink(job)
                const over = ['APPLIED', 'FAILED', 'CANCELLED'].includes(job.status)
                return (
                  <tr key={job.id}>
                    <th scope="row" className="max-w-xs px-3 py-2 font-normal">
                      <p className="truncate font-medium text-ink-900">{job.list_name}</p>
                      <p className="truncate text-xs text-ink-500">{job.file_name}{job.row_count ? ` · ${formatNumber(job.row_count)} rows` : ''}</p>
                    </th>
                    <td className="px-3 py-2"><StatusBadge status={job.working ? 'SENDING' : (TONE[job.status] ?? job.status)} label={job.working ? 'In Progress' : job.status === 'APPLIED' ? 'Imported' : job.status === 'REVIEW' || job.status === 'STAGED' ? 'Waiting for You' : undefined} /></td>
                    <td className="px-3 py-2">
                      <p className="mb-1 text-xs text-ink-700">{jobSummary(job)}</p>
                      {job.working && <ProgressBar job={job} />}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-500">{uploadedWhen(job)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="flex flex-wrap justify-end gap-2">
                        {resume && canImport && <button type="button" className={buttonSecondary} onClick={() => setParams({ resume: `${job.contact_list}:${job.id}` })}>Continue</button>}
                        {job.summary && <button type="button" className={buttonSecondary} onClick={() => setReportOf(job.id)}>Report</button>}
                        {job.status === 'APPLIED' && <Link to={`/contact-lists/${job.contact_list}`} className={buttonSecondary}>Open the List</Link>}
                        {!over && job.status !== 'APPLYING' && canImport && <button type="button" className={buttonSecondary} disabled={cancel.isPending} onClick={() => cancel.mutate(job)}>Cancel</button>}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {reportOf && rows.find((job) => job.id === reportOf) && (
        <Modal title="Upload Report" size="lg" onClose={() => setReportOf(null)} footer={<button type="button" className={buttonPrimary} onClick={() => setReportOf(null)}>Close</button>}>
          <p className="mb-3 text-sm text-ink-700">
            <strong className="text-ink-900">{rows.find((job) => job.id === reportOf)?.list_name}</strong> · {rows.find((job) => job.id === reportOf)?.file_name}
          </p>
          <UploadReport job={rows.find((job) => job.id === reportOf) as ListImport} />
        </Modal>
      )}

      {listId && importId && (
        <CreateListWizard
          resume={{ listId, importId }}
          onClose={() => setParams({})}
          onCreated={(list) => {
            void queryClient.invalidateQueries({ queryKey: ['contact-lists'] })
            setNotice(`“${list.name}” is ready.`)
            navigate(`/contact-lists/${list.id}`)
          }}
        />
      )}
    </section>
  )
}
