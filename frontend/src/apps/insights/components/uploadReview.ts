import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { keys, uploadsApi } from '../api'
import type { UploadColumn, UploadedFile } from '../types'

/** the review's state and Save: shared by the window here and Create Report's Upload a File */
/** upload: null until a file is read (Create Report holds the hook from its first screen); a new file starts the review afresh */
export function useUploadReview(upload: UploadedFile | null, onSaved: (saved: UploadedFile) => void) {
  const toast = useToast()
  const client = useQueryClient()
  const [name, setName] = useState(upload?.name ?? '')
  const [description, setDescription] = useState(upload?.description ?? '')
  const [columns, setColumns] = useState<UploadColumn[]>(upload?.columns ?? [])
  const [confirming, setConfirming] = useState(false)
  const [forId, setForId] = useState(upload?.id ?? null)
  if (upload && upload.id !== forId) {
    setForId(upload.id)
    setName(upload.name)
    setDescription(upload.description ?? '')
    setColumns(upload.columns)
    setConfirming(false)
  }
  const set = (key: string, patch: Partial<UploadColumn>) => setColumns(columns.map((c) => (c.key === key ? { ...c, ...patch } : c)))
  const save = useMutation({
    mutationFn: (confirm: boolean) => uploadsApi.update((upload as UploadedFile).id, { row_version: (upload as UploadedFile).row_version, name: name.trim(), description: description.trim() || null, ready: true, ...(confirm ? { confirm } : {}),
      columns: columns.map(({ key, label, type, role }) => ({ key, label, type, role })) }),
    onSuccess: (saved) => {
      client.invalidateQueries({ queryKey: keys.uploads })
      client.invalidateQueries({ queryKey: keys.catalog })
      toast.success(upload?.status === 'READY' ? 'Saved' : 'Dataset ready', `${saved.name}: ${formatNumber(saved.row_count)} rows to report on.`)
      onSaved(saved)
    },
    onError: (error) => { if (error instanceof ApiError && error.status === 409) setConfirming(true) },
  })
  const conflict = save.error instanceof ApiError && save.error.status === 409 ? save.error : null
  return { upload, name, setName, description, setDescription, columns, set, save, confirming, conflict }
}

export type UploadReview = ReturnType<typeof useUploadReview>
