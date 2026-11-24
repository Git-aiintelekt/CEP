/**
 * Under a running upload's bar: how far it is ("1,234,000 of 1,320,000 Customer IDs looked up") and about how long is left. The time
 * left is measured on this page, from the progress the poll reports: the rate between the first answer of this step and the latest.
 * It shows once the step has moved for a few seconds, and starts again when the step changes (reading, looking up, checking, adding).
 */
import { useEffect, useState } from 'react'

import { formatNumber } from '@/lib/format'
import type { ListImport } from '@/lib/types'

const MIN_SECONDS = 4
const first = new Map<string, { step: string; at: number; done: number }>()

export function timeLeftWords(seconds: number): string {
  if (seconds < 60) return 'less than a minute left'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} min left`
  const hours = Math.floor(minutes / 60)
  return `about ${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''} left`
}

function counted(job: Pick<ListImport, 'progress' | 'lookup' | 'phase'>): string {
  const { done, total, unit } = job.progress
  if (unit === 'bytes') return `${(done / 1024 / 1024).toFixed(1)} of ${(total / 1024 / 1024).toFixed(1)} MB read`
  const what = unit === 'ids' ? `${job.lookup?.id_label ?? 'ID'}s looked up` : job.phase === 'Adding contacts to the list' ? 'rows added' : 'rows checked'
  return `${formatNumber(done)} of ${formatNumber(total)} ${what}`
}

export function ProgressCount({ job, className = '' }: { job: Pick<ListImport, 'id' | 'progress' | 'lookup' | 'phase' | 'working'>; className?: string }) {
  const [left, setLeft] = useState<number | null>(null)
  const step = `${job.phase}:${job.progress.unit}:${job.progress.total}`
  const { done, total } = job.progress

  useEffect(() => {
    const now = Date.now()
    const start = first.get(job.id)
    if (!start || start.step !== step || done < start.done) {
      first.set(job.id, { step, at: now, done })
      setLeft(null)
      return
    }
    const seconds = (now - start.at) / 1000
    const rate = (done - start.done) / Math.max(seconds, 0.001)
    setLeft(seconds >= MIN_SECONDS && rate > 0 ? Math.max(0, (total - done) / rate) : null)
  }, [job.id, step, done, total])

  if (!job.working || total <= 0) return null
  return (
    <p className={`cep-num text-xs text-ink-800 ${className}`} data-progress-count>
      {counted(job)}{done > 0 ? ` · ${left === null ? 'working out the time left' : timeLeftWords(left)}` : ''}
    </p>
  )
}
