/**
 * Review an uploaded file: its name, then each column as read (its label, its type, a number as a measure or a dimension,
 * the first values), and the first rows. Save as Dataset makes it one reports can be built on. A column can be the type
 * read from its values, or text.
 */
import { buttonPrimary, buttonSecondary, Select, TextInput } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState } from '@/components/States'
import { formatNumber } from '@/lib/format'
import type { UploadColumn, UploadColumnType, UploadedFile } from '../types'
import { listHeadClass } from './listParams'
import { useUploadReview, type UploadReview } from './uploadReview'

const TYPE_LABEL: Record<UploadColumnType, string> = { string: 'Text', number: 'Number', date: 'Date', datetime: 'Date and Time', boolean: 'Yes or No' }

function shown(value: unknown, type: UploadColumnType): string {
  if (value === undefined || value === null) return '—'
  if (type === 'boolean' || typeof value === 'boolean') return value === true || value === 'true' ? 'Yes' : value === false || value === 'false' ? 'No' : String(value)
  if (type === 'datetime') return String(value).replace('T', ' ').slice(0, 16)
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return String(value)
}


export function UploadReviewDialog({ upload, onClose, onSaved }: { upload: UploadedFile; onClose: () => void; onSaved: (saved: UploadedFile) => void }) {
  const review = useUploadReview(upload, onSaved)
  const { name, save, confirming, conflict } = review
  return (
    <Modal title={upload.status === 'READY' ? 'Review the File' : 'Review the Columns'} subtitle={`${upload.file_name} · ${formatNumber(upload.row_count)} rows · ${upload.columns.length} columns`} onClose={onClose} size="xl" scrollBody
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          {confirming && conflict && <span className="mr-auto text-xs text-ink-800">{conflict.problem?.detail}</span>}
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          {confirming
            ? <button type="button" className={buttonPrimary} disabled={save.isPending} onClick={() => save.mutate(true)}>Change Anyway</button>
            : <button type="button" className={buttonPrimary} disabled={save.isPending || !name.trim()} onClick={() => save.mutate(false)}>{upload.status === 'READY' ? 'Save' : 'Save as Dataset'}</button>}
        </div>
      )}>
      <UploadReviewFields review={review} />
    </Modal>
  )
}

/** the dataset's name and description, each column as read, and the first rows */
export function UploadReviewFields({ review }: { review: UploadReview }) {
  const { upload, name, setName, description, setDescription, columns, set, save, conflict } = review
  const sample = upload?.sample ?? []
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-label font-medium text-ink-800">Name
          <TextInput aria-label="Dataset name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-label font-medium text-ink-800">Description
          <TextInput aria-label="Description" value={description} maxLength={300} placeholder={`Uploaded from ${upload?.file_name ?? "the file"}`} onChange={(event) => setDescription(event.target.value)} />
        </label>
      </div>
      <p className="text-sm text-ink-800">Each column was read from its values. Rename it, make it text, or make a number a dimension (a code or a year, say) so it groups rather than adds up.</p>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full text-sm" aria-label="Columns">
          <thead>
            <tr className={listHeadClass}>
              <th className="px-3 py-2 whitespace-nowrap">In the File</th><th className="px-3 py-2">Label</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Use As</th><th className="px-3 py-2">First Values</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((column) => (
              <tr key={column.key} className="border-t border-line-subtle align-top">
                <td className="px-3 py-2 text-ink-800">{column.source}</td>
                <td className="px-3 py-1.5"><TextInput className="min-w-32" aria-label={`${column.source} label`} controlSize="sm" value={column.label} maxLength={100} onChange={(event) => set(column.key, { label: event.target.value })} /></td>
                <td className="px-3 py-1.5"><Select className="min-w-32" aria-label={`${column.source} type`} controlSize="sm" value={column.type} disabled={column.types.length < 2}
                  onChange={(event) => { const type = event.target.value as UploadColumnType; set(column.key, { type, role: type === 'number' ? column.role : 'dimension' }) }}>
                  {column.types.map((type) => <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}
                </Select></td>
                <td className="px-3 py-1.5">{column.type === 'number'
                  ? <Select className="min-w-44" aria-label={`${column.source} use`} controlSize="sm" value={column.role} onChange={(event) => set(column.key, { role: event.target.value as UploadColumn['role'] })}>
                      <option value="measure">A Measure (Adds Up)</option><option value="dimension">A Dimension (Groups)</option>
                    </Select>
                  : <span className="flex h-8 items-center text-ink-800">A Dimension</span>}</td>
                <td className="px-3 py-2 text-ink-800"><span className="block max-w-44 truncate">{sample.slice(0, 3).map((row) => shown(row[column.column], column.inferred)).join(' · ')}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="mb-1.5 text-sm font-semibold text-ink-900">First Rows</h3>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-sm" aria-label="First rows">
            <thead><tr className={listHeadClass}>{columns.map((c) => <th key={c.key} className="px-3 py-2 whitespace-nowrap">{c.label}</th>)}</tr></thead>
            <tbody>
              {sample.slice(0, 5).map((row, index) => (
                <tr key={index} className="border-t border-line-subtle">{columns.map((c) => <td key={c.key} className={`px-3 py-1.5 whitespace-nowrap ${c.type === 'number' ? 'cep-num text-right' : ''}`}>{shown(row[c.column], c.inferred)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {save.isError && !conflict && <ErrorState title="The file was not saved" error={save.error} />}
    </div>
  )
}
