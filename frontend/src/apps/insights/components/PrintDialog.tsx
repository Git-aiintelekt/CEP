/**
 * Print-Ready PDF: every row of the report on numbered pages (Page 3 of 12), the header row repeating, the filters on the first
 * page, on A4 or Letter, upright or on its side, and optionally a section per value of the report's first field with its
 * subtotals, each on a new page.
 */
import { useState } from 'react'

import { Checkbox } from '@/components/Checkbox'
import { Field, Select, buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { useToast } from '@/components/Toast'
import { insightsApi } from '../api'

export function PrintDialog({ reportId, reportName, firstField, onClose }: { reportId: string; reportName: string; firstField?: string; onClose: () => void }) {
  const toast = useToast()
  const [size, setSize] = useState<'a4' | 'letter'>('a4')
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [group, setGroup] = useState(false)
  const [busy, setBusy] = useState(false)
  async function download() {
    setBusy(true)
    try {
      const blob = await insightsApi.exportPrint(reportId, { size, orientation, group })
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `${reportName}.pdf`
      link.click()
      URL.revokeObjectURL(link.href)
      onClose()
    } catch (error) {
      toast.failure(error, 'The PDF was not made')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Print-Ready PDF" subtitle={reportName} onClose={onClose}
      footer={<div className="flex justify-end gap-2"><button type="button" className={buttonSecondary} onClick={onClose}>Cancel</button><button type="button" className={buttonPrimary} disabled={busy} onClick={download}>{busy ? 'Making the PDF…' : 'Download PDF'}</button></div>}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-800">Every row on numbered pages, the header row on each page, and the report's filters on the first.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Paper">{(ids) => <Select id={ids.id} value={size} onChange={(event) => setSize(event.target.value as 'a4' | 'letter')}><option value="a4">A4</option><option value="letter">Letter</option></Select>}</Field>
          <Field label="Orientation">{(ids) => <Select id={ids.id} value={orientation} onChange={(event) => setOrientation(event.target.value as 'portrait' | 'landscape')}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></Select>}</Field>
        </div>
        {firstField && <Checkbox label={`A section per ${firstField}, each on a new page with its subtotals`} checked={group} onChange={(event) => setGroup(event.target.checked)} />}
      </div>
    </Modal>
  )
}
