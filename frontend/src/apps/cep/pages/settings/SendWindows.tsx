/**
 * Governance → Send Windows and Quiet Hours (docs/mockups/governance.html, option A): per channel, the hours and days marketing
 * may go out, in the workspace's time zone. A send due outside waits for the window to open; it is never skipped. The
 * platform's windows are shown locked; the workspace's own can only narrow them.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, Lock } from 'lucide-react'
import { useState } from 'react'

import { TextInput } from '@/components/Form'
import { Tag } from '@/components/StatusBadge'
import { Switch } from '@/components/Switch'
import { api } from '@/lib/api'
import { saveFailure } from '@/lib/saveFeedback'
import type { GovernanceWindow, GovernanceWindowChannel } from '@/lib/types'

const KEY = ['workspace', 'governance']
const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']] as const
const NOUN: Record<GovernanceWindowChannel['channel'], string> = { EMAIL: 'emails', SMS: 'texts', WHATSAPP: 'WhatsApp messages' }

const minutes = (clock: string) => {
  const [hours, mins] = clock.split(':').map(Number)
  return (hours || 0) * 60 + (mins || 0)
}

/** '07:00–21:00, every day' / '10:00–20:00, Mon–Fri', as the server words it */
function describe(start: string, end: string, days: number[]) {
  const sorted = [...new Set(days)].sort()
  const which = sorted.length === 7 ? 'every day' : sorted.join() === '1,2,3,4,5' ? 'Mon–Fri' : sorted.join() === '6,7' ? 'weekends'
    : sorted.map((day) => DAYS.find(([number]) => number === day)?.[1]).join(', ')
  return `${start}–${end}, ${which}`
}

/** the window on a 24-hour bar: one segment, or two when it runs past midnight */
function DayBar({ start, end, muted }: { start: string; end: string; muted: boolean }) {
  const from = (minutes(start) / 1440) * 100
  const to = (minutes(end) / 1440) * 100
  const segments = from < to ? [[from, to - from]] : [[from, 100 - from], [0, to]]
  return (
    <div aria-hidden>
      <div className="relative h-2 overflow-hidden rounded-full bg-fill-subtle">
        {segments.map(([left, width]) => (
          <span key={left} className={`absolute inset-y-0 ${muted ? 'bg-ink-300' : 'bg-brand-600'}`} style={{ left: `${left}%`, width: `${width}%` }} />
        ))}
      </div>
      <div className="cep-num mt-1 flex justify-between text-[11px] text-ink-800"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
    </div>
  )
}

function WindowRow({ entry, editable }: { entry: GovernanceWindowChannel; editable: boolean }) {
  const queryClient = useQueryClient()
  const own = entry.own
  const active = own?.is_active ?? false
  const [start, setStart] = useState(own?.start ?? entry.recommended.start)
  const [end, setEnd] = useState(own?.end ?? entry.recommended.end)
  const [days, setDays] = useState<number[]>(own?.days ?? entry.recommended.days)
  const save = useMutation({
    mutationFn: (body: Partial<{ start: string; end: string; days: number[]; is_active: boolean }>) =>
      api.put<GovernanceWindowChannel>(`/workspace/governance/windows/${entry.channel}/`, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
  })
  const errors = save.isError ? saveFailure(save.error, 'The window was not saved', ['start', 'end', 'days']) : null
  const commit = (body: Partial<{ start: string; end: string; days: number[] }>) => {
    if (active) save.mutate(body)
  }
  const toggleDay = (day: number) => {
    const next = days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort()
    setDays(next)
    commit({ days: next })
  }
  const noun = NOUN[entry.channel]
  return (
    <div className="flex flex-col gap-3 border-t border-line-subtle py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">{entry.channel_label}</p>
          <p className="text-sm text-ink-800">
            {active && own ? `Marketing ${noun} go out ${describe(own.start, own.end, own.days)}. Outside them, a send waits for the window to open.`
              : `Off: no window of your own for ${noun}.`}
          </p>
        </div>
        {editable ? (
          <Switch checked={active} disabled={save.isPending} ariaLabel={`${entry.channel_label} send window in use`}
            onChange={() => save.mutate(active ? { is_active: false } : { start, end, days, is_active: true })} />
        ) : own && <span className="text-sm text-ink-800">{own.is_active ? 'On' : 'Off'}</span>}
      </div>

      {editable && (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-800">From
            <div className="w-36"><TextInput type="time" aria-label={`${entry.channel_label} window from`} value={start} disabled={save.isPending}
              onChange={(event) => setStart(event.target.value)} onBlur={() => start !== own?.start && commit({ start })} /></div>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-800">To
            <div className="w-36"><TextInput type="time" aria-label={`${entry.channel_label} window to`} value={end} disabled={save.isPending}
              onChange={(event) => setEnd(event.target.value)} onBlur={() => end !== own?.end && commit({ end })} /></div>
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-ink-800">Days</span>
            <div className="mt-1 flex min-h-10 flex-wrap items-center gap-1.5" role="group" aria-label={`${entry.channel_label} window days`}>
              {DAYS.map(([day, label]) => (
                <button key={day} type="button" aria-pressed={days.includes(day)} disabled={save.isPending} onClick={() => toggleDay(day)}
                  className={`h-8 rounded-md border px-2.5 text-xs font-medium transition-colors duration-base ease-standard ${days.includes(day) ? 'border-brand-600 bg-brand-100 text-brand-800' : 'border-line bg-surface text-ink-800 hover:bg-fill-subtle'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <DayBar start={editable ? start : own?.start ?? entry.recommended.start} end={editable ? end : own?.end ?? entry.recommended.end} muted={!active} />
      {errors && <p className="text-helper font-medium text-danger-text" role="alert">{errors.fields.start ?? errors.fields.end ?? errors.fields.days ?? errors.short}</p>}

      {entry.platform.map((window: GovernanceWindow) => (
        <p key={window.id} className="flex flex-wrap items-center gap-2 text-helper text-ink-800">
          <Tag icon={Building2}>Platform</Tag><span className="cep-num text-ink-900">{window.rule}</span>{!window.is_active && <span>Off</span>}
          <span className="inline-flex items-center gap-1" title="Set by the platform for your workspace; changed in the back-office."><Lock size={14} strokeWidth={1.5} aria-hidden />Locked</span>
        </p>
      ))}
      {entry.quiet_hours && (
        <p className="flex flex-wrap items-center gap-2 text-helper text-ink-800">
          <Tag icon={Building2}>Platform</Tag>Quiet hours <span className="cep-num font-semibold text-ink-900">{entry.quiet_hours.start}–{entry.quiet_hours.end}</span>: a text due inside them waits until they end.
        </p>
      )}
    </div>
  )
}

export function SendWindows({ windows, editable }: { windows: GovernanceWindowChannel[]; editable: boolean }) {
  return (
    <div role="group" aria-label="Send Windows">
      {windows.map((entry) => (
        <WindowRow key={`${entry.channel}-${entry.own?.row_version ?? 0}-${entry.own?.start ?? ''}-${entry.own?.end ?? ''}-${entry.own?.days.join('') ?? ''}`} entry={entry} editable={editable} />
      ))}
    </div>
  )
}
