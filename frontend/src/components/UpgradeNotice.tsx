/** The upgrade notice, in every workspace (GET /platform-status/, Platform → Scheduled Upgrade in the back-office):
 * - before: an amber strip with the start in the viewer's own time zone, dismissible until 15 minutes before;
 * - during: the page dims under "Upgrade in Progress" (or "Reconnecting" when no upgrade was known) while the API does not
 *   answer or the install script says it is upgrading; it checks every 10 s and lifts by itself, and what was typed stays;
 * - after: a dark toast offers Reload once /version.json names another build than the one running; Later hides it for five
 *   minutes. Nothing reloads by itself. */
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { UNREACHABLE_EVENT } from '@/lib/api'
import type { UpgradeNotice as Notice } from '@/lib/types'
import { CHECK_MS, clock, fetchStatus, FIRM_BEFORE_MS, isDown, newerBuild, PLATFORM_STATUS_KEY, POLL_MS, SHOW_AFTER_MS, VERSION_EVERY_MS, whenWords } from '@/lib/upgradeNotice'

const DISMISSED_KEY = 'cep.upgrade.dismissed'

function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

function ScheduledStrip({ notice, now }: { notice: Notice; now: Date }) {
  const [dismissed, setDismissed] = useState(readDismissed)
  const startsAt = notice.starts_at ? new Date(notice.starts_at) : null
  if (!startsAt || Number.isNaN(startsAt.getTime())) return null
  const firm = startsAt.getTime() - now.getTime() <= FIRM_BEFORE_MS
  if (dismissed === notice.starts_at && !firm) return null
  const length = notice.minutes ? `, about ${notice.minutes} minute${notice.minutes === 1 ? '' : 's'}` : ''
  const lead = startsAt <= now ? `The scheduled upgrade is starting now${length}.` : `Scheduled upgrade ${whenWords(startsAt, now)}${length}.`
  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, notice.starts_at ?? '')
    } catch {
      /* private window: hidden for this page only */
    }
    setDismissed(notice.starts_at ?? '')
  }
  return (
    <div role="status" className="flex items-center gap-3 border-b border-warning/40 bg-warning-bg px-4 py-2 text-sm text-warning-text md:px-8">
      <CalendarClock size={16} strokeWidth={1.75} aria-hidden className="shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{lead}</span> Save your work before then.{notice.note ? ` ${notice.note}` : ''}
      </p>
      {!firm && (
        <button type="button" aria-label="Hide Until Closer to the Time" onClick={dismiss}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm transition-colors hover:bg-warning/20">
          <X size={15} strokeWidth={1.5} aria-hidden />
        </button>
      )}
    </div>
  )
}

function PauseCard({ upgrading, since, lastTry, checking, onCheck }: { upgrading: boolean; since: Date; lastTry: number; checking: boolean; onCheck: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(tick)
  }, [])
  useEffect(() => {
    button.current?.focus()
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    return () => root?.removeAttribute('inert')
  }, [])
  const seconds = Math.max(0, Math.ceil(((lastTry || now) + CHECK_MS - now) / 1000))
  return createPortal(
    <div className="fixed inset-0 z-[70] flex animate-fade-in items-center justify-center bg-scrim p-4 motion-reduce:animate-none">
      <div role="alertdialog" aria-modal="true" aria-labelledby="cep-upgrade-title" aria-describedby="cep-upgrade-body"
        className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-line bg-surface-overlay p-5">
        <h2 id="cep-upgrade-title" className="flex items-center gap-2 font-display text-card-heading font-semibold text-ink-900">
          <LoaderCircle size={18} strokeWidth={1.75} aria-hidden className="shrink-0 animate-spin text-brand-600 motion-reduce:animate-none" />
          {upgrading ? 'Upgrade in Progress' : 'Reconnecting'}
        </h2>
        <p id="cep-upgrade-body" className="text-sm text-ink-800">
          {upgrading ? 'C360 is being upgraded and will be back in a few minutes.' : 'C360 cannot be reached right now. It will reconnect as soon as it answers.'}{' '}
          Your unsaved changes stay on this page.
        </p>
        <p className="text-helper text-ink-700">{checking ? 'Checking now' : `Checking again in ${seconds} s`} · since {clock(since)}</p>
        <div>
          <button ref={button} type="button" onClick={onCheck} disabled={checking}
            className="h-8 rounded-control-md border border-line bg-surface px-3 text-sm font-medium text-ink-900 transition-colors hover:bg-fill-subtle disabled:text-ink-300">
            Check Now
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ReloadToast({ version, onLater }: { version: string; onLater: () => void }) {
  return createPortal(
    <div role="status" className="fixed right-4 bottom-4 z-[60] flex max-w-[92vw] items-center gap-2.5 rounded-lg bg-toast py-2 pr-1.5 pl-3.5 shadow-toast sm:max-w-md">
      <p className="text-sm font-semibold text-on-brand">C360 has been upgraded to {version}. Save your changes, then reload.</p>
      <button type="button" onClick={() => window.location.reload()}
        className="ml-1 inline-flex h-7 shrink-0 items-center rounded-sm px-2 text-sm font-semibold text-toast-action transition-colors hover:bg-white/[0.12]">
        Reload
      </button>
      <button type="button" aria-label="Later" onClick={onLater}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-white/[0.72] transition-colors hover:bg-white/[0.12] hover:text-on-brand">
        <X size={15} strokeWidth={1.5} aria-hidden />
      </button>
    </div>,
    document.body,
  )
}

export function UpgradeNotice() {
  const [unreachableAt, setUnreachableAt] = useState(0)
  const [shownSince, setShownSince] = useState<Date | null>(null)
  const [newVersion, setNewVersion] = useState<string | null>(null)
  const [toastHidden, setToastHidden] = useState(false)

  const status = useQuery({
    queryKey: PLATFORM_STATUS_KEY,
    queryFn: ({ signal }) => fetchStatus(signal),
    refetchInterval: shownSince || unreachableAt ? CHECK_MS : POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  })
  const notice: Notice | undefined = status.data?.upgrade?.state ? status.data.upgrade : undefined
  // the API is silent while the last status call failed that way, or another call failed after the last answer
  const down = (status.isError && isDown(status.error)) || unreachableAt > status.dataUpdatedAt
  const pausing = down || notice?.state === 'UPGRADING'
  const { refetch } = status

  const checkVersion = useCallback(() => {
    void newerBuild().then((found) => {
      if (found) setNewVersion(found)
    })
  }, [])

  // a call anywhere in the app found the API silent: confirm with the status call before dimming anything
  useEffect(() => {
    const onUnreachable = () => {
      setUnreachableAt(Date.now())
      void refetch()
    }
    window.addEventListener(UNREACHABLE_EVENT, onUnreachable)
    return () => window.removeEventListener(UNREACHABLE_EVENT, onUnreachable)
  }, [refetch])

  // the card waits a moment, so a one-off hiccup never flashes it; when the API answers again it lifts and the build is compared
  useEffect(() => {
    if (!pausing) return
    let shown = false
    const timer = window.setTimeout(() => {
      shown = true
      setShownSince(new Date())
    }, SHOW_AFTER_MS)
    return () => {
      window.clearTimeout(timer)
      setShownSince(null)
      setUnreachableAt(0)
      if (shown) checkVersion()
    }
  }, [pausing, checkVersion])

  useEffect(() => {
    if (notice?.state === 'DONE') checkVersion()
  }, [notice?.state, checkVersion])

  useEffect(() => {
    const every = window.setInterval(() => {
      setToastHidden(false)
      checkVersion()
    }, VERSION_EVERY_MS)
    window.addEventListener('focus', checkVersion)
    return () => {
      window.clearInterval(every)
      window.removeEventListener('focus', checkVersion)
    }
  }, [checkVersion])

  const now = new Date(Math.max(status.dataUpdatedAt, status.errorUpdatedAt) || 0)
  const card = pausing && shownSince !== null
  return (
    <>
      {notice?.state === 'SCHEDULED' && !card && <ScheduledStrip key={notice.starts_at ?? ''} notice={notice} now={status.dataUpdatedAt ? now : new Date(notice.changed_at ?? 0)} />}
      {card && <PauseCard upgrading={notice?.state === 'UPGRADING' || notice?.state === 'SCHEDULED'} since={shownSince} lastTry={now.getTime()}
        checking={status.isFetching} onCheck={() => void refetch()} />}
      {newVersion && !toastHidden && !card && <ReloadToast version={newVersion} onLater={() => setToastHidden(true)} />}
    </>
  )
}
