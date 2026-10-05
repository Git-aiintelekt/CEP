/** Small building blocks the campaign screens share: choice cards, panels, cards, facts, metrics and meters. */
import { CircleAlert } from 'lucide-react'
import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { formatMoney, formatNumber } from '@/lib/format'

/**
 * One of a small set of options, shown as a card: the campaign type and channel pickers. Put them in a ChoiceGroup.
 * `tile`: a 24px icon over the title and description (beside them on phones), for the Create Campaign pop-up.
 */
export function ChoiceCard({ selected, onSelect, title, text, icon, badge, disabled = false, tile = false }: {
  selected: boolean; onSelect: () => void; title: string; text: string; icon?: ReactNode; badge?: string; disabled?: boolean; tile?: boolean
}) {
  const state = selected ? 'border-brand-600 bg-brand-100' : tile ? 'border-line bg-surface hover:border-brand-600' : 'border-line bg-surface hover:bg-surface-subtle'
  const titleTone = selected ? 'text-brand-800' : 'text-ink-900'
  const id = useId()
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      disabled={disabled}
      onClick={onSelect}
      className={`flex h-full rounded-lg border text-left transition-colors duration-fast ease-standard disabled:cursor-not-allowed disabled:bg-fill-subtle disabled:text-ink-300 ${state} ${
        tile ? 'min-w-0 flex-col items-start gap-1.5 p-3.5' : 'flex-col items-start gap-1 p-3'
      }`}
    >
      {tile ? (
        // the set-up pop-ups' card (the "Setup Dialog" design): the icon with any tag on one row, then the title and its line
        <>
          <span className="flex w-full items-center justify-between gap-2">
            {icon ? <span aria-hidden className={`flex shrink-0 [&>svg]:h-5 [&>svg]:w-5 ${selected ? 'text-brand-600' : 'text-ink-800'}`}>{icon}</span> : <span />}
            {badge && <span className="inline-flex h-5 shrink-0 items-center rounded-sm bg-plum-100 px-1.5 text-[11px] font-semibold whitespace-nowrap text-plum-800">{badge}</span>}
          </span>
          <span id={`${id}-title`} className="text-sm font-semibold text-ink-900">{title}</span>
          <span id={`${id}-text`} className="text-helper text-ink-800">{text}</span>
        </>
      ) : (
        <>
          <span className={`flex items-center gap-2 text-sm font-semibold ${titleTone}`}>
            {icon && <span className={selected ? 'text-brand-800' : 'text-ink-800'}>{icon}</span>}
            <span id={`${id}-title`}>{title}</span>
          </span>
          <span id={`${id}-text`} className="text-xs text-ink-800">{text}</span>
          {badge && <span className="mt-1 rounded-sm bg-fill-subtle px-1.5 py-0.5 text-xs font-semibold text-ink-800">{badge}</span>}
        </>
      )}
    </button>
  )
}

/** A radio group of ChoiceCards: one tab stop (the chosen card, or the first), and the arrow keys move and choose. */
export function ChoiceGroup({ label, error, hint, columns = 'sm:grid-cols-2', required = false, strong = false, labelId, children }: {
  label: string; error?: string; hint?: string; columns?: string; required?: boolean; strong?: boolean; labelId?: string; children: ReactNode
}) {
  const group = useRef<HTMLDivElement>(null)
  const ownId = useId()
  const headingId = labelId ?? ownId
  const errorId = `${headingId}-error`
  const hintId = `${headingId}-hint`
  useLayoutEffect(() => {
    const radios = [...(group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? [])]
    const stop = radios.find((radio) => radio.getAttribute('aria-checked') === 'true') ?? radios[0]
    radios.forEach((radio) => { radio.tabIndex = radio === stop ? 0 : -1 })
  })
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (!step) return
    const radios = [...(group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? [])]
    const at = radios.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    event.preventDefault()
    const next = radios[(at + step + radios.length) % radios.length]
    next.focus()
    next.click()
  }
  return (
    <div>
      <p id={headingId} className={strong ? 'text-sm font-semibold text-ink-900' : 'text-sm font-medium text-ink-800'}>
        {label}
        {required && <span className="ml-0.5 text-danger-plain" aria-hidden>*</span>}
      </p>
      <div ref={group} role="radiogroup" aria-labelledby={headingId} aria-required={required || undefined} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? errorId : hint ? hintId : undefined}
        onKeyDown={onKeyDown} className={`${strong ? 'mt-1.5' : 'mt-1'} grid gap-3 ${columns}`}>{children}</div>
      {!error && hint && <p id={hintId} className={`${strong ? 'mt-1.5' : 'mt-1'} text-helper text-ink-800`}>{hint}</p>}
      {error && (
        <p id={errorId} className={strong ? 'mt-1.5 flex items-start gap-1.5 text-helper font-medium text-danger-text' : 'mt-1 text-xs font-medium text-danger-text'}>
          {strong && <CircleAlert size={16} strokeWidth={1.5} aria-hidden className="mt-px shrink-0" />}
          {error}
        </p>
      )}
    </div>
  )
}

export function Panel({ title, description, actions, children, className = '' }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-surface p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="font-display text-card-heading font-semibold text-ink-900">{title}</h2>}
            {description && <p className="mt-0.5 max-w-2xl text-sm text-ink-800">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

/**
 * A card of the campaign page: a titled header bar with its links on the right, then a padded body (none with `flush`, for a table from md up).
 * `muted` is for what the campaign can't change: a grey title and a Gray 75 body.
 */
export function DetailCard({ title, tag, icon, description, actions, flush = false, muted = false, children }: {
  title: string; tag?: ReactNode; icon?: ReactNode; description?: string; actions?: ReactNode; flush?: boolean; muted?: boolean; children: ReactNode
}) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="min-w-0 rounded-lg border border-line bg-surface">
      <div className={`flex flex-wrap justify-between gap-x-4 gap-y-2 border-b border-line-subtle px-6 py-4 sm:flex-nowrap ${description ? 'items-start' : 'items-center'}`}>
        <div className="min-w-0 sm:flex-1">
          <div className="flex min-w-0 items-center gap-2">
            {icon}
            <h2 id={titleId} className={`font-display text-card-heading font-semibold ${muted ? 'text-ink-800' : 'text-ink-900'}`}>{title}</h2>
            {tag}
          </div>
          {description && <p className="mt-0.5 text-helper text-ink-800">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-helper">{actions}</div>}
      </div>
      <div className={`${flush ? 'p-4 md:p-0' : 'p-6'} ${muted ? 'rounded-b-lg bg-surface-subtle' : ''}`}>{children}</div>
    </section>
  )
}

/** A card's failed request, inline: what couldn't load, the reason when there is one, and Retry. Every card on the campaign page uses it. */
export function CardError({ what = 'this', error, onRetry }: { what?: string; error?: unknown; onRetry: () => void }) {
  const reason = error instanceof Error && error.message ? ` ${error.message}` : ''
  return (
    <p role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-helper text-ink-800">
      <span>Couldn’t load {what}.{reason}</span>
      <button type="button" onClick={onRetry} className="font-semibold text-brand-600 hover:underline">Retry</button>
    </p>
  )
}

/** a heading for a group inside a card: "Scheduling & Delivery", "Reasons" */
export function CardSubheading({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h3 className={`text-card-title font-semibold text-ink-900 ${className}`}>{children}</h3>
}

/** a DetailCard's header link: "See All", "Edit Setup" */
export function CardLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="text-helper font-semibold text-brand-800 hover:underline">{children}</Link>
}

/** Facts sit in columns at least 260px wide, one column on a phone */
export const FACTS_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6'

/** One labelled value inside a DetailCard's <dl>. */
export function Fact({ label, secondary, className = '', children }: { label: string; secondary?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`} data-fact={label}>
      <dt className="text-helper font-semibold text-ink-800">{label}</dt>
      <dd className="cep-num text-card-title break-words text-ink-900">{children}</dd>
      {secondary && <dd className="cep-num text-helper text-ink-800">{secondary}</dd>}
    </div>
  )
}

/** A number of the campaign's results: Overview's Metrics card and the Performance tab's Results card. Put them in a <dl>. */
export function Metric({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1" data-metric={label}>
      <dt className="text-helper font-semibold text-ink-800">{label}</dt>
      <dd className="cep-num font-display text-2xl font-semibold text-ink-900">{value}</dd>
      {note && <dd className="cep-num text-helper text-ink-800">{note}</dd>}
    </div>
  )
}

/** Progress against a target: an 8px bar, brand until the target is met, then success. Past 100% the bar stays full and the number says by how much. */
export function Meter({ label, actual, target, percent, money = false }: { label: string; actual: number; target: number; percent: number; money?: boolean }) {
  const show = (value: number) => (money ? formatMoney(value, { whole: true }) : formatNumber(value))
  const met = percent >= 100
  return (
    <div className="flex flex-col gap-2" data-meter={label}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-ink-900">{label}</span>
        <span className="cep-num text-helper text-ink-800">{show(actual)} of {show(target)} · {percent}%</span>
      </div>
      <div role="progressbar" aria-label={`${label} against target`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(percent))} className="h-2 overflow-hidden rounded-xs bg-fill-subtle">
        <div data-met={met || undefined} className={`h-full rounded-xs ${met ? 'bg-success' : 'bg-brand-600'}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  )
}

export function Definition({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-helper font-semibold text-ink-800">{label}</dt>
      <dd className="mt-1 text-sm text-ink-900">{children}</dd>
    </div>
  )
}

export function CheckRow({ id, checked, onChange, label, hint, disabled }: { id: string; checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" aria-describedby={hint ? `${id}-hint` : undefined} />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink-900">{label}</label>
        {hint && <p id={`${id}-hint`} className="text-xs text-ink-800">{hint}</p>}
      </div>
    </div>
  )
}
