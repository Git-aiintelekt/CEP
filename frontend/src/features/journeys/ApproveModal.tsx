/** "Activate this Journey?" — Approve & Activate's own pop-up: activate now, or schedule for later with the shared
 * DatePicker (month calendar) and TimePicker (half-hour slots). */
import { Rocket } from 'lucide-react'
import { useMemo, useState } from 'react'

import { DatePicker } from '@/components/DatePicker'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Spinner } from '@/components/States'
import { TimePicker } from '@/components/TimePicker'
import { toDateValue } from '@/lib/dateValue'
import { formatNumber } from '@/lib/format'
import type { JourneyTestResult } from '@/lib/types'

import { RadioCard } from './RadioCard'
import { IconTile, SummaryBox, SummaryRow } from './RunTestModal'

interface ApproveModalProps {
  testResult: JourneyTestResult
  populationModeLabel: string
  entryLabel: string
  submitting: boolean
  onCancel: () => void
  onConfirm: (schedule: Date | null) => void
}

/** "HH:MM" of the next half hour from now, the earliest slot today */
function nextSlotToday(now: Date): string {
  const minutes = now.getHours() * 60 + now.getMinutes()
  const next = Math.ceil((minutes + 1) / 30) * 30
  return next >= 24 * 60 ? '24:00' : `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`
}

export function ApproveModal({ testResult, populationModeLabel, entryLabel, submitting, onCancel, onConfirm }: ApproveModalProps) {
  const [mode, setMode] = useState<'NOW' | 'LATER'>('NOW')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [openedAt] = useState(() => new Date())
  const today = toDateValue(openedAt)
  const earliestTime = date === today ? nextSlotToday(openedAt) : undefined

  const scheduledAt = useMemo(() => {
    if (mode === 'NOW' || !date || !time) return null
    const combined = new Date(`${date}T${time}:00`)
    return Number.isNaN(combined.getTime()) || combined <= openedAt ? null : combined
  }, [mode, date, time, openedAt])

  const canConfirm = mode === 'NOW' || scheduledAt !== null
  const passed = testResult.delivered > 0 && testResult.bounced < testResult.sent_to

  return (
    <Modal
      title="Activate This Journey?"
      onClose={onCancel}
      escapeClosesMenusFirst
      badge={<IconTile tone="brand"><Rocket size={20} strokeWidth={1.75} aria-hidden /></IconTile>}
      footer={
        <>
          <button type="button" className={`${buttonSecondary} flex-1`} onClick={onCancel} disabled={submitting}>Cancel</button>
          <button type="button" className={`${buttonPrimary} flex-1`} disabled={submitting || !canConfirm} onClick={() => onConfirm(scheduledAt)}>
            {submitting ? <Spinner size="sm" /> : null} {mode === 'NOW' ? 'Activate Journey' : 'Schedule Journey'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-900">Once activated, this Journey runs automatically and continuously — no further manual action is needed.</p>

        <SummaryBox>
          <SummaryRow label="Test Result">
            <span className={passed ? 'text-success-text' : 'text-warning-text'}>
              {passed ? 'Passed' : 'Completed'} — {formatNumber(testResult.delivered)}/{formatNumber(testResult.sent_to)} Delivered
            </span>
          </SummaryRow>
          <SummaryRow label="Entry Criteria">{entryLabel}</SummaryRow>
          <SummaryRow label="Population Mode">{populationModeLabel}</SummaryRow>
        </SummaryBox>

        <div role="radiogroup" aria-label="When to Activate" className="space-y-3">
          <RadioCard
            name="approve-mode"
            checked={mode === 'NOW'}
            onSelect={() => setMode('NOW')}
            title="Activate Immediately"
            description="Journey goes live and starts enrolling customers as soon as you confirm."
          />
          <RadioCard
            name="approve-mode"
            checked={mode === 'LATER'}
            onSelect={() => setMode('LATER')}
            title="Schedule for Later"
            description="Pick a date and time — the Journey stays in Approved status until then."
          >
            <div className="mt-3 grid grid-cols-2 gap-2">
              <DatePicker
                label="Activation Date"
                value={date}
                min={today}
                onChange={(value) => {
                  setDate(value)
                  if (value === today && time && time < nextSlotToday(openedAt)) setTime('')
                }}
              />
              <TimePicker label="Activation Time" value={time} min={earliestTime} onChange={setTime} />
            </div>
          </RadioCard>
        </div>
      </div>
    </Modal>
  )
}
