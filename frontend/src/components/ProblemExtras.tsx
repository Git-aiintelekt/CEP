/**
 * Under a "C360 had a problem" message (docs/mockups/error-details.html, A then C): the platform team's note when the problem is
 * known (written on the back-office Errors page), and Copy Details, which copies what support needs in plain text: the
 * reference, the time, the workspace, the page, what was being done and who was signed in. Nothing technical: safe to paste
 * into an email or a ticket. Shows only for C360's own problems (a failure with a reference).
 */
import { useState } from 'react'

import { useOptionalAuth } from '@/auth/AuthContext'
import type { SaveFailure } from '@/lib/saveFeedback'

function when(iso: string | null): string {
  const at = iso ? new Date(iso) : new Date()
  const local = at.toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  return `${local} (${at.toISOString().slice(11, 16)} UTC)`
}

export function problemDetails(failure: SaveFailure, who: { workspace?: string; name?: string; visiting?: boolean }): string {
  return [
    `Reference: ${failure.reference}`,
    `When: ${when(failure.at)}`,
    who.workspace && `Workspace: ${who.workspace}`,
    `Page: ${window.location.pathname}`,
    failure.title && `What failed: ${failure.title}`,
    who.name && `Signed in as: ${who.name}${who.visiting ? ' (Switch Workspace)' : ''}`,
  ].filter(Boolean).join('\n')
}

export function ProblemExtras({ failure }: { failure: SaveFailure | null }) {
  const auth = useOptionalAuth()
  const [copied, setCopied] = useState(false)
  if (!failure?.reference) return null
  const principal = auth?.me?.principal
  const text = problemDetails(failure, {
    workspace: auth?.me?.tenant?.code ?? auth?.tenant, name: principal?.display_name || principal?.email, visiting: Boolean(auth?.me?.platform_visit),
  })
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="mt-2 flex flex-col gap-2">
      {failure.note && (
        <p className="rounded-sm border border-line border-l-[3px] border-l-link bg-callout-bg px-3 py-2 text-ink-900" data-known-problem>
          <span className="font-semibold">Known problem.</span> {failure.note}
        </p>
      )}
      <p className="flex items-center gap-3">
        <button type="button" onClick={() => void copy()} className="font-medium underline underline-offset-2">Copy Details</button>
        <span aria-live="polite" className="text-xs">{copied ? 'Copied' : ''}</span>
      </p>
    </div>
  )
}
