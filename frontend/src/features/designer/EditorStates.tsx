/** The two whole-window states the editor shows in place of itself: opening, and not opening at all. */
import { CircleAlert, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'

const SPIN = 'animate-[spin_900ms_linear_infinite] motion-reduce:animate-[spin_1800ms_linear_infinite]'

export function EditorLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-surface-subtle">
      <LoaderCircle size={28} strokeWidth={1.5} aria-hidden className={`${SPIN} text-ink-800`} />
      <p role="status" className="text-sm font-semibold text-ink-800">
        {label}
      </p>
    </div>
  )
}

export function EditorFailure({ title, detail, onRetry, footer }: { title: string; detail: string; onRetry: () => void; footer?: ReactNode }) {
  return (
    <div role="alert" className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-2.5 bg-surface-subtle p-6 text-center">
      <CircleAlert size={28} strokeWidth={1.5} aria-hidden className="text-danger" />
      <p className="text-base font-semibold text-ink-900">{title}</p>
      <p className="max-w-[360px] text-helper text-ink-800">{detail}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 inline-flex h-9 items-center rounded-sm bg-brand-600 px-4 text-[13px] font-semibold text-on-brand transition-colors duration-base ease-standard hover:bg-brand-fill-hover"
      >
        Retry
      </button>
      {footer}
    </div>
  )
}
