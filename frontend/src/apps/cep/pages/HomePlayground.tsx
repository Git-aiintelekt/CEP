/**
 * /dev/home (dev builds only): the Home page on sample data inside the app shell, with switches for the account state and
 * the viewer. Nothing here reaches the API.
 */
import { useMemo, useState } from 'react'

import { SegmentedControl } from '@/components/SegmentedControl'
import { HomePage } from '@/apps/cep/features/home/HomePage'
import { HomeDataProvider } from '@/apps/cep/features/home/data/HomeDataProvider'
import { SAMPLE_STATES, createSampleSource, type SampleState } from '@/apps/cep/features/home/data/sampleSource'
import { SAMPLE_VIEWER } from '@/apps/cep/features/home/data/sampleViewer'
import type { HomeViewer } from '@/apps/cep/features/home/data/types'

type ViewerKind = 'admin' | 'member' | 'readOnly' | 'noReceipts'

const READ_ONLY_DENIED = new Set(['campaign.edit', 'template.edit', 'list.edit', 'journey.edit', 'report.view', 'user.admin'])
const VIEWERS: Record<ViewerKind, HomeViewer> = {
  admin: SAMPLE_VIEWER,
  member: { ...SAMPLE_VIEWER, can: (permission) => permission !== 'user.admin' },
  readOnly: { ...SAMPLE_VIEWER, can: (permission) => !READ_ONLY_DENIED.has(permission) },
  /** an admin in a workspace without e-receipts */
  noReceipts: { ...SAMPLE_VIEWER, has: (feature) => feature !== 'ereceipt' },
}
const VIEWER_OPTIONS: { value: ViewerKind; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Not Admin' },
  { value: 'readOnly', label: 'Viewer (Read Only)' },
  { value: 'noReceipts', label: 'No E-Receipts' },
]

export default function HomePlayground() {
  const [state, setState] = useState<SampleState>('busy')
  const [viewer, setViewer] = useState<ViewerKind>('admin')
  const source = useMemo(() => createSampleSource(state), [state])
  return (
    <>
      <div data-playground-switches className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-dashed border-line pb-4">
        <SegmentedControl label="Account State" variant="outline" options={SAMPLE_STATES} value={state} onChange={setState} />
        <SegmentedControl label="Viewer" variant="outline" options={VIEWER_OPTIONS} value={viewer} onChange={setViewer} />
      </div>
      <HomeDataProvider source={source} viewer={VIEWERS[viewer]}>
        <HomePage />
      </HomeDataProvider>
    </>
  )
}
