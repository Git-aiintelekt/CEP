/** What the report visuals share: a tooltip, a reason in place of a visual, and the numbers as a table. */
import { useState, type ReactNode } from 'react'

export function VisualReason({ children, minHeight }: { children: ReactNode; minHeight: number }) {
  return <div className="flex items-center justify-center rounded-md border border-dashed border-line p-6 text-center text-sm text-ink-800" style={{ minHeight }}>{children}</div>
}

/** the floating label beside a hovered mark */
export function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const flip = x + 220 > width
  return (
    <div role="presentation" data-visual-tooltip className="pointer-events-none absolute z-10 flex min-w-36 flex-col gap-1 rounded-lg border border-line bg-surface-overlay px-3 py-2 text-helper shadow-toast"
      style={{ top: Math.max(0, y - 8), left: flip ? x - 12 : x + 12, transform: flip ? 'translateX(-100%)' : undefined }}>
      {children}
    </div>
  )
}

export function TipLine({ label, value }: { label: string; value: string }) {
  return <span className="flex items-center gap-3 whitespace-nowrap"><span className="text-ink-800">{label}</span><span className="cep-num ml-auto font-semibold text-ink-900">{value}</span></span>
}

/** the numbers behind a visual: hidden for screen readers to read, or opened below it */
export function NumbersTable({ title, header, rows }: { title: string; header: string[]; rows: string[][] }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((now) => !now)} className="text-helper font-semibold text-brand-800 hover:underline">{open ? 'Hide the Numbers' : 'Show the Numbers'}</button>
      <div className={open ? 'mt-3 max-h-64 overflow-auto rounded-lg border border-line' : 'sr-only'}>
        <table className="min-w-full divide-y divide-line text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="sticky top-0 bg-surface-subtle"><tr>{header.map((cell, i) => <th key={i} scope="col" className={`h-10 px-4 text-xs font-semibold text-ink-900 ${i ? 'text-right' : 'text-left'}`}>{cell}</th>)}</tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((row, r) => <tr key={r} className="h-10">{row.map((cell, i) => (i ? <td key={i} className="cep-num px-4 text-right text-ink-900">{cell}</td> : <th key={i} scope="row" className="px-4 text-left font-normal text-ink-800">{cell}</th>))}</tr>)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
