/**
 * Detail Report: the fields other reports on the same dataset can open this one through. A right-click on a value of a
 * ticked field elsewhere offers this report, which opens filtered to that value.
 */
import { useState } from 'react'

import { Checkbox } from '@/components/Checkbox'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import type { CatalogDataset } from '../types'

export function DetailReportDialog({ dataset, fields, onApply, onClose }: { dataset: CatalogDataset; fields: string[]; onApply: (fields: string[]) => void; onClose: () => void }) {
  const [ticked, setTicked] = useState<string[]>(fields)
  const offered = dataset.fields.filter((field) => field.role === 'dimension' && field.type !== 'date' && field.type !== 'datetime')
  return (
    <Modal title="Detail Report" subtitle="Other reports on this dataset can open this one through a value" onClose={onClose} size="md"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button>
          <button type="button" className={buttonPrimary} onClick={() => onApply(ticked)}>Apply</button>
        </div>
      )}>
      <p className="mb-3 text-sm text-ink-800">Tick the fields this report can be opened through. A right-click on a value of one of them, in a chart or a grid of {dataset.label}, will offer this report filtered to that value.</p>
      <ul aria-label="Fields to open through" className="grid gap-1.5 sm:grid-cols-2">
        {offered.map((field) => (
          <li key={field.key}>
            <Checkbox label={field.label} checked={ticked.includes(field.key)} onChange={(event) => setTicked(event.target.checked ? [...ticked, field.key] : ticked.filter((key) => key !== field.key))} className="text-sm" />
          </li>
        ))}
      </ul>
    </Modal>
  )
}
