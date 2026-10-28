/** Which folder a report is filed in, for whoever may change it: the workspace's folders, none, or New Folder, which asks for a name. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { buttonPrimary, buttonSecondary, Field, Select, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { keys, libraryApi, useFolders } from '../api'

const NEW = '__new__'

/** `bare` leaves out the label beside the select, for a row that labels it (Report Details) */
export function FolderSelect({ value, onChange, disabled, bare = false }: { value: string | null; onChange: (folderId: string | null) => void; disabled?: boolean; bare?: boolean }) {
  const folders = useFolders()
  const client = useQueryClient()
  const toast = useToast()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => libraryApi.createFolder(name.trim()),
    onSuccess: (folder) => {
      client.invalidateQueries({ queryKey: keys.folders })
      setNaming(false)
      setName('')
      onChange(folder.id)
    },
    onError: (error) => toast.failure(error, 'The folder was not made'),
  })
  const error = create.error instanceof ApiError ? create.error.fieldErrors.name : undefined
  return (
    <>
      <label className="flex items-center gap-1.5 text-xs text-ink-800">
        {!bare && <span>Folder</span>}
        <span className={bare ? 'w-60' : 'w-44'}><Select aria-label="Folder" controlSize="sm" value={value ?? ''} disabled={disabled || folders.isPending}
          onChange={(event) => { if (event.target.value === NEW) setNaming(true); else onChange(event.target.value || null) }}>
          <option value="">No folder</option>
          {(folders.data?.folders ?? []).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          <option value={NEW}>New Folder…</option>
        </Select></span>
      </label>
      {naming && (
        <Modal title="New Folder" onClose={() => setNaming(false)} footer={(
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonSecondary} onClick={() => setNaming(false)}>Cancel</button>
            <button type="button" className={buttonPrimary} onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>Make Folder</button>
          </div>
        )}>
          <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate() }}>
            <Field label="Name" error={error} required>
              {({ id, describedBy, invalid }) => <TextInput id={id} describedBy={describedBy} invalid={invalid} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus />}
            </Field>
          </form>
        </Modal>
      )}
    </>
  )
}
