import { CircleAlert, Clock, Eye, EyeOff } from 'lucide-react'
import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react'

/**
 * The shell both unauthenticated screens sit in: a navy brand panel beside a 400px form column.
 * The design splits at 860px, which is between Tailwind's md and lg, so the breakpoint is written out.
 */

const RINGS = [
  { left: '-38%', top: '-18%', width: '132%', alpha: 0.16 },
  { left: '-22%', top: '-4%', width: '112%', alpha: 0.11 },
  { left: '-6%', top: '10%', width: '92%', alpha: 0.07 },
  { left: '12%', top: '24%', width: '70%', alpha: 0.05 },
]

function BrandPanel() {
  return (
    <div className="cep-auth-panel relative hidden shrink-0 flex-col justify-between overflow-hidden p-[clamp(3.5rem,3vw,6rem)] [isolation:isolate] min-[860px]:flex min-[860px]:w-[45.4545%]">
      <div aria-hidden className="cep-auth-wash absolute -inset-y-[20%] -inset-x-[30%] z-0" />
      <div aria-hidden className="cep-auth-rings absolute inset-0 z-0 opacity-50">
        {RINGS.map((ring) => (
          <div
            key={ring.width}
            className="cep-auth-ring absolute aspect-square rounded-full"
            style={{ left: ring.left, top: ring.top, width: ring.width, ['--ring-alpha' as string]: ring.alpha }}
          />
        ))}
      </div>
      <div aria-hidden className="cep-auth-flow absolute inset-0 z-0 overflow-hidden">
        <div className="absolute -inset-y-[25%] -inset-x-[10%]" />
      </div>
      <div aria-hidden className="cep-auth-vignette absolute inset-0 z-0" />

      <div className="relative z-10 flex items-center gap-3">
        <span className="font-display text-[22px] font-bold tracking-[-0.03em] text-white">CEP</span>
        <span aria-hidden className="h-4 w-px bg-brand-100/30" />
        <span className="text-[13px] text-brand-100">Customer Engagement Platform</span>
      </div>

      <div className="relative z-10 flex max-w-[clamp(440px,26vw,640px)] flex-col gap-5">
        <span aria-hidden className="h-0.5 w-10 bg-brand-600" />
        <h1 className="text-[clamp(2.5rem,2.2vw,3.5rem)] leading-[1.16] font-semibold text-white text-pretty">
          Every customer signal, orchestrated into action.
        </h1>
        <p className="text-[clamp(0.9375rem,0.85vw,1.125rem)] leading-relaxed text-brand-100 text-pretty">
          Plan, launch and measure engagement across email, SMS, MMS and e-receipts from one workspace.
        </p>
      </div>
    </div>
  )
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen w-full bg-surface">
      <BrandPanel />

      <div className="flex min-w-0 flex-1 flex-col px-6 py-8">
        {/* the wordmark only has to stand in for the panel once the panel is gone */}
        <div className="flex items-center gap-2.5 pb-10 min-[860px]:hidden">
          <span className="font-display text-xl font-bold tracking-[-0.03em] text-wordmark-navy">CEP</span>
          <span aria-hidden className="h-3.5 w-px bg-line" />
          <span className="text-[13px] text-ink-700">Customer Engagement Platform</span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="w-full max-w-[400px]">{children}</div>
        </div>

        <div className="flex justify-center">
          <footer className="flex w-full max-w-[400px] flex-wrap gap-4 text-[13px] text-ink-700">
            <span>© 2026 CEP</span>
            {/* plain text until these pages exist — a link to nowhere is worse than no link */}
            <span>Privacy</span>
            <span>Terms</span>
          </footer>
        </div>
      </div>
    </div>
  )
}

/** Each step fades and rises on entry, so moving between them reads as one flow rather than a page swap. */
export function AuthStep({ children }: { children: ReactNode }) {
  return <div className="flex animate-step-in flex-col gap-6">{children}</div>
}

export function AuthHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-[28px] leading-[1.2] font-semibold text-ink-900">{title}</h2>
      {children && <p className="text-sm leading-normal text-ink-700">{children}</p>}
    </div>
  )
}

/** A quiet link-button: the design uses these for "Forgot password?" and every "Back to log in". */
export function AuthLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start rounded-sm text-[13px] font-medium text-brand-600 transition-colors hover:text-brand-800"
    >
      {children}
    </button>
  )
}

export const authButtonPrimary =
  'flex h-10 w-full items-center justify-center rounded-control-lg bg-brand-600 text-sm font-semibold text-white transition-colors hover:bg-brand-800 active:bg-wordmark-navy disabled:bg-line-subtle disabled:text-ink-300'
export const authButtonSecondary =
  'flex h-10 w-full items-center justify-center rounded-control-lg border border-line bg-surface text-sm font-semibold text-ink-900 transition-colors hover:bg-surface-subtle disabled:bg-line-subtle disabled:text-ink-300'

const CONTROL =
  'h-10 w-full rounded-control-lg border bg-surface-subtle px-3 text-sm text-ink-900 transition-colors focus-visible:border-brand-600'

/** A labelled control in the design's language: 13px label, sunken field, red border while the value is refused. */
export function AuthField({
  label,
  error,
  action,
  invalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; action?: ReactNode; invalid?: boolean }) {
  const id = useId()
  const errorId = `${id}-error`
  const bad = invalid || Boolean(error)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-ink-900">
          {label}
        </label>
        {action}
      </div>
      <input
        {...props}
        id={id}
        aria-invalid={bad || undefined}
        aria-describedby={error ? errorId : undefined}
        className={`${CONTROL} ${bad ? 'border-danger' : 'border-line'}`}
      />
      {error && (
        <span id={errorId} className="text-[13px] text-danger-plain">
          {error}
        </span>
      )}
    </div>
  )
}

/** Same field with a reveal toggle. Typing a password you cannot see is the main cause of a failed sign-in. */
export function AuthPasswordField({
  label,
  error,
  action,
  invalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; action?: ReactNode; invalid?: boolean }) {
  const id = useId()
  const errorId = `${id}-error`
  const [shown, setShown] = useState(false)
  const bad = invalid || Boolean(error)
  const Icon = shown ? EyeOff : Eye
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-ink-900">
          {label}
        </label>
        {action}
      </div>
      <div className="relative flex items-center">
        <input
          {...props}
          id={id}
          type={shown ? 'text' : 'password'}
          aria-invalid={bad || undefined}
          aria-describedby={error ? errorId : undefined}
          className={`${CONTROL} pr-11 ${bad ? 'border-danger' : 'border-line'}`}
        />
        <button
          type="button"
          onClick={() => setShown((current) => !current)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          className="absolute right-1 flex h-8 w-8 items-center justify-center rounded-control-md text-ink-700 transition-colors hover:bg-line-subtle"
        >
          <Icon size={16} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
      {error && (
        <span id={errorId} className="text-[13px] text-danger-plain">
          {error}
        </span>
      )}
    </div>
  )
}

/** The banner above the form for anything the server refused outright. */
export function AuthAlert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-sm bg-danger-bg p-3">
      <CircleAlert size={16} strokeWidth={1.5} aria-hidden className="mt-px flex-none text-danger-plain" />
      <span className="text-[13px] leading-normal text-danger-plain">{children}</span>
    </div>
  )
}

/** A heads-up, not a failure: nothing was done wrong (e.g. signed out after being idle). Amber, not the alert's red. */
export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-sm bg-warning-bg p-3">
      <Clock size={16} strokeWidth={1.5} aria-hidden className="mt-px flex-none text-warning-text" />
      <span className="text-[13px] leading-normal text-warning-text">{children}</span>
    </div>
  )
}
