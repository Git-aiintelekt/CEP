import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { buttonDanger, buttonPrimary, buttonSecondary, Field, TextInput } from '@/components/Form'
import { PageHeader } from '@/components/ResourceList'
import { ErrorState, Spinner } from '@/components/States'
import { api, ApiError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import type { MfaSetup, MfaStatus, TokenPair } from '@/lib/types'

/** The QR library is only needed during enrolment: loaded on demand, rendered as an inline SVG (no image request leaves the browser). */
function QrCode({ text }: { text: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void import('qrcode-generator').then((module) => {
      const qr = module.default(0, 'M')
      qr.addData(text)
      qr.make()
      if (live) setSvg(qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }))
    })
    return () => {
      live = false
    }
  }, [text])
  return (
    <div role="img" aria-label="QR code for your authenticator app" className="h-44 w-44 shrink-0 rounded-lg border border-line bg-surface p-1 [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />
  )
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="rounded-lg border border-success bg-surface-subtle p-5">
      <h2 className="text-sm font-semibold text-success-text">Multi-factor authentication is on</h2>
      <p className="mt-1 text-sm text-success-text">Keep these recovery codes somewhere safe, away from your phone. Each one signs you in once if you lose your authenticator. They are shown only now.</p>
      <ul aria-label="Recovery codes" className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-surface px-4 py-3 cep-num text-sm text-ink-900 sm:grid-cols-5">
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={buttonSecondary} onClick={() => void navigator.clipboard?.writeText(codes.join('\n')).then(() => setCopied(true), () => undefined)}>{copied ? 'Copied' : 'Copy codes'}</button>
        <button type="button" className={buttonPrimary} onClick={onDone}>I have saved them</button>
      </div>
    </div>
  )
}

export function AccountSecurityPage() {
  const { me, adopt } = useAuth()
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: ['mfa'], queryFn: ({ signal }) => api.get<MfaStatus>('/auth/mfa/', undefined, signal) })
  const [setup, setSetup] = useState<MfaSetup | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [pendingTokens, setPendingTokens] = useState<TokenPair | null>(null)
  const [turningOff, setTurningOff] = useState(false)

  const begin = useMutation({ mutationFn: () => api.post<MfaSetup>('/auth/mfa/', { action: 'setup' }), onSuccess: (data) => { setSetup(data); setCode('') } })
  const confirm = useMutation({
    mutationFn: () => api.post<{ recovery_codes: string[] } & TokenPair>('/auth/mfa/', { action: 'confirm', code: code.trim() }),
    onSuccess: (data) => {
      setCodes(data.recovery_codes)
      setPendingTokens({ access: data.access, refresh: data.refresh })          // adopted after the codes were saved: adopting reloads the page state
      setSetup(null)
    },
  })
  const disable = useMutation({
    mutationFn: () => api.post('/auth/mfa/', { action: 'disable', code: code.trim() }),
    onSuccess: () => { setTurningOff(false); setCode(''); void queryClient.invalidateQueries({ queryKey: ['mfa'] }) },
  })

  function finish() {
    setCodes(null)
    if (pendingTokens) adopt(pendingTokens)                                     // fresh tokens without the enrol-first restriction
    else void queryClient.invalidateQueries({ queryKey: ['mfa'] })
  }

  const codeError = (error: unknown) => (error instanceof ApiError && error.status === 400 ? error.fieldErrors.code ?? error.fieldErrors.action ?? error.message : undefined)
  const forced = Boolean(me?.mfa_setup_required)

  return (
    <section className="max-w-3xl">
      <PageHeader title="Account security" description="A second step when you sign in: a code from an authenticator app on your phone." />
      {forced && !codes && (
        <p role="status" className="mb-5 rounded-lg border border-warning bg-warning-bg px-4 py-3 text-sm text-warning-text">
          Your workspace requires multi-factor authentication. Set it up to continue: nothing else is available until you do.
        </p>
      )}

      {codes ? <RecoveryCodes codes={codes} onDone={finish} />
        : status.isPending ? <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner size="sm" /> Loading</p>
        : status.isError ? <ErrorState error={status.error} onRetry={() => void status.refetch()} />
        : status.data.sso ? (
          <div className="rounded-lg border border-line bg-surface p-5 text-sm text-ink-700">You sign in through your company's single sign-on. The second step, if any, is managed there.</div>
        ) : status.data.enabled ? (
          <div className="rounded-lg border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">Multi-factor authentication is on</h2>
                <p className="mt-0.5 text-sm text-ink-500">Since {formatDate(status.data.confirmed_at)} · {status.data.recovery_codes_left} recovery code{status.data.recovery_codes_left === 1 ? '' : 's'} left</p>
              </div>
              {!status.data.required && !turningOff && <button type="button" className={buttonDanger} onClick={() => { setTurningOff(true); setCode(''); disable.reset() }}>Turn off</button>}
            </div>
            {status.data.required && <p className="mt-3 text-xs text-ink-500">Your workspace requires it, so it cannot be turned off.</p>}
            {status.data.recovery_codes_left <= 2 && <p className="mt-3 text-xs text-warning-text">Few recovery codes are left. To get a new set, turn multi-factor authentication off and set it up again.</p>}
            {turningOff && (
              <form className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4" onSubmit={(event: FormEvent) => { event.preventDefault(); disable.mutate() }}>
                <div className="w-48"><Field label="Current code" required error={codeError(disable.error)}>
                  {(ids) => <TextInput {...ids} value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" autoFocus />}
                </Field></div>
                <button type="submit" className={buttonDanger} disabled={disable.isPending || !code.trim()}>Turn off</button>
                <button type="button" className={buttonSecondary} onClick={() => setTurningOff(false)}>Cancel</button>
              </form>
            )}
          </div>
        ) : setup ? (
          <form className="rounded-lg border border-line bg-surface p-5" onSubmit={(event: FormEvent) => { event.preventDefault(); confirm.mutate() }}>
            <ol className="space-y-5 text-sm text-ink-700">
              <li>
                <p className="font-semibold text-ink-900">1. Scan this code with your authenticator app</p>
                <p className="mt-0.5 text-ink-500">Google Authenticator, Microsoft Authenticator, 1Password, Authy and similar apps all work.</p>
                <div className="mt-3 flex flex-wrap items-start gap-4">
                  <QrCode text={setup.otpauth_uri} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Cannot scan? Type this key</p>
                    <p className="mt-1 cep-num text-sm break-all text-ink-900">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</p>
                  </div>
                </div>
              </li>
              <li>
                <p className="font-semibold text-ink-900">2. Enter the 6-digit code it shows</p>
                <div className="mt-2 w-48"><Field label="Code" required error={codeError(confirm.error)}>
                  {(ids) => <TextInput {...ids} value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" />}
                </Field></div>
              </li>
            </ol>
            {confirm.isError && !codeError(confirm.error) && <div className="mt-4"><ErrorState title="Could not turn it on" error={confirm.error} /></div>}
            <div className="mt-5 flex gap-2">
              <button type="submit" className={buttonPrimary} disabled={confirm.isPending || code.trim().length < 6}>Turn on</button>
              {!forced && <button type="button" className={buttonSecondary} onClick={() => setSetup(null)}>Cancel</button>}
            </div>
          </form>
        ) : (
          <div className="rounded-lg border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold text-ink-900">Multi-factor authentication is off</h2>
            <p className="mt-1 text-sm text-ink-500">With it on, a stolen password is not enough to get into your account.</p>
            {begin.isError && <div className="mt-3"><ErrorState title="Could not start the set-up" error={begin.error} /></div>}
            <button type="button" className={`mt-4 ${buttonPrimary}`} disabled={begin.isPending} onClick={() => begin.mutate()}>Set up</button>
          </div>
        )}
    </section>
  )
}
