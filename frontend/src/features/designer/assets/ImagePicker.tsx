/**
 * Choose an image: what opens when a block needs a picture and none has been chosen for it yet.
 *
 * Everything already in the library is one click away, and an upload goes into the library as well as into
 * the block — so the same picture is there for the next block without uploading it twice.
 */
import { Modal } from '@/components/Modal'

import type { DesignerAsset } from '../EmailDesigner'
import { AssetGrid } from './AssetGrid'
import { UploadButton } from './UploadButton'

export const PICKER_TITLE = 'Choose an Image'
export const PICKER_HELP = 'Pick one from the library, or upload. One upload goes straight into the block; several are kept in the library to pick from.'
export const PICKER_CANCEL = 'Cancel'

interface ImagePickerProps {
  assets: DesignerAsset[]
  uploading?: string[]
  onUpload: (files: File[]) => void
  onChoose: (asset: DesignerAsset) => void
  onClose: () => void
}

export function ImagePicker({ assets, uploading = [], onUpload, onChoose, onClose }: ImagePickerProps) {
  return (
    <Modal
      title={PICKER_TITLE}
      onClose={onClose}
      size="lg"
      footer={
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 items-center rounded-sm border border-line bg-surface px-3 text-sm font-medium text-ink-800 transition-colors duration-base ease-standard hover:bg-surface-hover"
        >
          {PICKER_CANCEL}
        </button>
      }
    >
      <p className="mb-3 text-sm text-ink-800">{PICKER_HELP}</p>
      <div className="mb-4 max-w-[240px]">
        <UploadButton onUpload={onUpload} />
      </div>
      <div className="max-h-[46vh] overflow-y-auto">
        <AssetGrid assets={assets} uploading={uploading} onUse={onChoose} columns={4} />
      </div>
    </Modal>
  )
}
