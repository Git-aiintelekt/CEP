import { Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'

const LOOK = {
  /** the quick view's footer */
  plain: { button: 'h-8 gap-1.5 rounded-control-md px-2 text-helper font-medium hover:bg-line-subtle', icon: 16 },
  /** among the campaign page's header chips */
  chip: { button: 'h-6 gap-1 rounded-control-sm border border-line px-2 text-xs font-semibold hover:bg-surface-subtle', icon: 12 },
}

/** "ID {code}": copies the campaign code, shows a check for a moment and says so to screen readers */
export function CopyId({ code, look = 'plain' }: { code: string; look?: keyof typeof LOOK }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timer)
  }, [copied])
  const style = LOOK[look]
  const Icon = copied ? Check : Copy
  return (
    <>
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(code).then(() => setCopied(true))}
        className={`cep-num inline-flex shrink-0 items-center text-ink-500 transition-colors duration-fast ease-standard ${style.button}`}
      >
        ID {code}
        <Icon size={style.icon} strokeWidth={1.5} aria-hidden className={copied ? 'text-success' : 'text-ink-700'} />
      </button>
      <span role="status" className="sr-only">{copied ? 'Campaign ID copied' : ''}</span>
    </>
  )
}
