/** Upload image: the one route into the library, from the Assets tab and from the picker dialog alike. */
import { Upload } from 'lucide-react'
import { useRef } from 'react'

import { ACCEPTED_TYPES, acceptedImages } from './assetAction'

export const UPLOAD_LABEL = 'Upload image'

export function UploadButton({ disabled = false, onUpload }: { disabled?: boolean; onUpload: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)

  return (
    <>
      <button
        type="button"
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (disabled) return
          input.current?.click()
        }}
        className={`inline-flex h-8 w-full items-center justify-center gap-2 rounded-sm border px-3 text-sm font-medium transition-colors ${
          disabled ? 'border-line bg-line-subtle text-ink-300' : 'border-line bg-surface text-ink-700 hover:bg-surface-subtle'
        }`}
      >
        <Upload size={16} strokeWidth={1.5} aria-hidden />
        {UPLOAD_LABEL}
      </button>
      {/* hidden, never disabled: the button above is the keyboard route to it */}
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        multiple
        className="hidden"
        onChange={(event) => {
          const chosen = acceptedImages(Array.from(event.target.files ?? []))
          event.target.value = '' // so the same file can be picked again after a failure
          if (chosen.length > 0) onUpload(chosen)
        }}
      />
    </>
  )
}
