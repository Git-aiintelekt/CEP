/** An instant setting's confirmation (docs/mockups/save-feedback.html, option A): "✓ Saved" beside the control that changed,
 * fading after two seconds; "Not saved · Try again" when it failed (the reason shows under the card, as before). A page's
 * one save mutation serves all its controls: each tick answers only when the save carried its own field. */
import type { UseMutationResult } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'

const SHOWN_MS = 2000
const FADE_MS = 600

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMutation = UseMutationResult<any, unknown, any, any>

function carries(variables: unknown, field: string | undefined): boolean {
  if (field === undefined) return true
  return Boolean(variables && typeof variables === 'object' && field in (variables as Record<string, unknown>))
}

/** `of`: on a list where one mutation saves every row's control, whether the last save was this row's */
export function SaveTick({ mutation, field, of = true }: { mutation: AnyMutation; field?: string; of?: boolean }) {
  // how far the confirmation of this save has gone: 0 shown, 1 fading, 2 gone (moved on by timers, keyed by the save)
  const [stage, setStage] = useState({ save: -1, step: 0 })
  const mine = of && carries(mutation.variables, field)
  const { status, submittedAt } = mutation

  useEffect(() => {
    if (!mine || status !== 'success') return
    const fade = window.setTimeout(() => setStage({ save: submittedAt, step: 1 }), SHOWN_MS)
    const hide = window.setTimeout(() => setStage({ save: submittedAt, step: 2 }), SHOWN_MS + FADE_MS)
    return () => {
      window.clearTimeout(fade)
      window.clearTimeout(hide)
    }
  }, [mine, status, submittedAt])

  // the room the tick will take, kept empty: the word is drawn by CSS so the page's text holds no "Saved" before a save
  if (!mine || status === 'idle' || status === 'pending') return <span aria-live="polite" data-save-tick="idle" className="invisible inline-flex shrink-0 text-helper before:content-['Saved']" />
  if (status === 'error') {
    return (
      // polite: the reason under the card is the page's alert, one interruption per failure
      <span aria-live="polite" className="inline-flex shrink-0 items-center gap-1 text-helper font-semibold text-danger-text">
        Not saved ·
        <button type="button" className="underline underline-offset-2" onClick={() => mutation.mutate(mutation.variables)}>Try again</button>
      </span>
    )
  }
  const step = stage.save === submittedAt ? stage.step : 0
  return (
    <span aria-live="polite" className={`inline-flex shrink-0 items-center gap-1 text-helper font-semibold text-success-text transition-opacity duration-500 ${
      step === 0 ? 'opacity-100' : step === 1 ? 'opacity-45' : 'invisible opacity-0'}`}>
      <Check size={14} strokeWidth={2.25} aria-hidden /> Saved
    </span>
  )
}
