/** A 4px determinate bar; the fill eases to each new value (110ms). */
export function ProgressBar({ value, label }: { /** 0 to 100 */ value: number; label: string }) {
  const percent = Math.min(100, Math.max(0, Math.round(value)))
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1 w-full overflow-hidden rounded-pill bg-fill-muted">
      <div
        className="h-full rounded-pill bg-brand-600 transition-[width] duration-base ease-standard motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}
