/**
 * Upload a File on Insights → Uploaded Files (docs/mockups/insights-admin-pages.html), in the shared create frame: 1 Choose
 * the File (drop it or choose it; it is read at once), 2 Review the Columns (the same fields as Create Report's), then Save
 * as Dataset and on to a new report. A file dropped on the page opens here already reading. Review Columns on a file
 * already uploaded is the second screen alone.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'

import { SetupDialog, type SetupPrimary } from '@/components/SetupDialog'
import { Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { formatNumber } from '@/lib/format'
import { keys, uploadsApi } from '../api'
import type { UploadedFile } from '../types'
import { UploadReviewFields } from './UploadReviewDialog'
import { useUploadReview } from './uploadReview'

const UPLOAD_ACCEPT = '.csv,.txt,.tsv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const STEPS = ['Choose the File', 'Review the Columns']

export function UploadFlow({ file, existing, limits, onClose, onSaved }: {
  /** a file dropped on the page: read at once */
  file?: File
  /** a file already uploaded: Review Columns, the second screen alone */
  existing?: UploadedFile
  limits?: { bytes: number; rows: number; columns: number }
  onClose: () => void
  /** saved; firstTime when the file became a dataset just now */
  onSaved: (saved: UploadedFile, firstTime: boolean) => void
}) {
  const toast = useToast()
  const client = useQueryClient()
  const chooser = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<UploadedFile | null>(existing ?? null)
  const [step, setStep] = useState(existing ? 2 : 1)
  const [over, setOver] = useState(false)
  const firstTime = draft?.status !== 'READY'
  const review = useUploadReview(draft, (saved) => onSaved(saved, firstTime))
  const read = useMutation({
    mutationFn: (chosen: File) => uploadsApi.upload(chosen),
    onSuccess: (made) => { client.invalidateQueries({ queryKey: keys.uploads }); setDraft(made); setStep(2) },
    onError: (error) => toast.failure(error, 'The file was not read'),
  })
  const started = useRef(false)
  useEffect(() => {
    if (file && !started.current) { started.current = true; read.mutate(file) }
  }, [file, read])
  const take = (chosen: File | undefined) => { if (chosen && !read.isPending) read.mutate(chosen) }
  const dropped = (event: DragEvent) => { event.preventDefault(); setOver(false); take(event.dataTransfer.files[0]) }

  const primary: SetupPrimary = step === 1
    ? { label: 'Next', disabled: !draft, onClick: () => setStep(2) }
    : review.confirming
      ? { label: 'Change Anyway', busy: review.save.isPending, busyLabel: 'Saving', onClick: () => review.save.mutate(true) }
      : { label: firstTime ? 'Save as Dataset' : 'Save', disabled: !review.name.trim(), busy: review.save.isPending, busyLabel: 'Saving', onClick: () => review.save.mutate(false) }

  return (
    <SetupDialog title={existing ? 'Review the File' : 'Upload a File'} steps={existing ? [] : STEPS} step={step} onClose={onClose} wide={step === 2}
      onBack={step === 2 && !existing ? () => setStep(1) : undefined} primary={primary} locked={read.isPending || review.save.isPending}>
      {step === 1 ? (
        <div className="flex flex-col gap-3">
          <div onDragOver={(event) => { event.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={dropped}
            className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center ${over ? 'border-brand-600 bg-brand-100/40' : 'border-line-control bg-surface-subtle'}`}>
            <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-md bg-brand-100 text-brand-800"><Upload size={20} strokeWidth={1.5} /></span>
            {read.isPending ? <p role="status" className="flex items-center gap-2 text-sm text-ink-800"><Spinner size="sm" /> Reading the file</p> : (
              <>
                <p className="text-sm font-semibold text-ink-900">Drop a CSV or Excel file here</p>
                <p className="max-w-md text-helper text-ink-800">
                  or <button type="button" className="font-medium text-link hover:underline" onClick={() => chooser.current?.click()}>choose a file</button>. The first row names the columns; in a workbook the first sheet is read.
                  {limits ? ` Up to ${formatNumber(limits.rows)} rows, ${limits.columns} columns and ${Math.round(limits.bytes / 1048576)} MB.` : ''}
                </p>
              </>
            )}
            <input ref={chooser} type="file" accept={UPLOAD_ACCEPT} className="hidden" aria-label="Choose a file to upload" onChange={(event) => { const chosen = event.target.files?.[0]; event.target.value = ''; take(chosen) }} />
          </div>
          {draft && <p className="text-helper text-ink-800">Read: {draft.file_name} · {formatNumber(draft.row_count)} rows · {draft.columns.length} columns. Next to review them.</p>}
          <p className="text-helper text-ink-800">Next you name the dataset and check each column. Nothing becomes a dataset until you save it.</p>
        </div>
      ) : draft && (
        <div className="flex flex-col gap-3">
          <p className="text-helper text-ink-800">{draft.file_name} · {formatNumber(draft.row_count)} rows · {draft.columns.length} columns</p>
          <UploadReviewFields review={review} />
          {review.confirming && review.conflict && <p className="text-helper text-ink-800">{review.conflict.problem?.detail}</p>}
        </div>
      )}
    </SetupDialog>
  )
}
