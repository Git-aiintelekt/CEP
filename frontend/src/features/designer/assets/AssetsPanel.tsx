/** The image library beside the canvas. Knows nothing about GrapesJS: uploading, dragging and applying are the caller's. */
import type { PointerEvent as ReactPointerEvent } from 'react'

import type { DesignerAsset } from '../EmailDesigner'
import { AssetGrid } from './AssetGrid'
import { UploadButton } from './UploadButton'

export { EMPTY_NOTE } from './AssetGrid'

interface AssetsPanelProps {
  assets: DesignerAsset[]
  /** file names still going up, shown as placeholders in the grid */
  uploading?: string[]
  disabled?: boolean
  message?: string | null
  onUpload: (files: File[]) => void
  onUse: (asset: DesignerAsset) => void
  onDragStart?: (asset: DesignerAsset, event: ReactPointerEvent) => void
}

export function AssetsPanel({ assets, uploading = [], disabled = false, message, onUpload, onUse, onDragStart }: AssetsPanelProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-surface">
      <div className="shrink-0 px-3 pt-3">
        <UploadButton disabled={disabled} onUpload={onUpload} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <AssetGrid assets={assets} uploading={uploading} disabled={disabled} onUse={onUse} onDragStart={onDragStart} />
      </div>

      <p role="status" aria-live="polite" className="min-h-9 border-t border-line px-3 py-2 text-xs text-ink-800">
        {message ?? ''}
      </p>
    </div>
  )
}
