/**
 * Change with a Prompt: "by channel only, as a bar chart", "add last year", "only email". The AI changes the definition being
 * edited and the editor shows it at once, unsaved; Undo puts the one before back. The model reads the dataset's fields and the
 * definition, never rows; a change it makes counts as one prompt.
 */
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { buttonSecondary } from '@/components/Form'
import { ApiError } from '@/lib/api'
import { assistantApi, useAssistant } from '../api'
import { AiPill } from '../components/AskForReport'
import type { ReportDefinition } from '../types'

export function ChangeWithPrompt({ dataset, definition, onChange }: { dataset: string; definition: ReportDefinition; onChange: (next: ReportDefinition) => void }) {
  const assistant = useAssistant()
  const [prompt, setPrompt] = useState('')
  const [before, setBefore] = useState<ReportDefinition | null>(null)
  const [said, setSaid] = useState<string | null>(null)
  const change = useMutation({
    mutationFn: () => assistantApi.change({ dataset, definition, prompt: prompt.trim(), model: assistant.data?.default_model ?? undefined }),
    onSuccess: (reply) => {
      if (reply.kind === 'draft' && reply.definition) {
        setBefore(definition)
        onChange({ ...reply.definition, view: reply.view ?? reply.definition.view })
        setSaid(`Changed: ${prompt.trim()}. Not saved yet.`)
        setPrompt('')
      } else if (reply.kind === 'question') {
        setSaid(`${reply.question} ${(reply.answers ?? []).map((a) => a.label).join(' or ')}?`)
      } else {
        setSaid(reply.message ?? 'No field holds what that asks for.')
      }
    },
    onError: (error) => setSaid(error instanceof ApiError ? error.problem?.detail ?? error.message : 'The change did not come back. Try again.'),
  })
  if (!assistant.data?.enabled) return null
  return (
    <form aria-label="Change with a prompt" className="flex flex-col gap-1.5" onSubmit={(event) => { event.preventDefault(); if (prompt.trim()) change.mutate() }}>
      <div className="flex items-center gap-2">
        <AiPill />
        <input aria-label="What to change" value={prompt} maxLength={1000} onChange={(event) => setPrompt(event.target.value)} placeholder="Change it with a prompt: by channel only, as a bar chart"
          className="h-8 min-w-0 flex-1 rounded-control-md border border-line-control bg-surface px-2.5 text-sm text-ink-900 placeholder:text-ink-700 focus-visible:border-focus focus-visible:outline-none" />
        <button type="submit" className={buttonSecondary} disabled={!prompt.trim() || change.isPending}>{change.isPending ? 'Changing…' : 'Change'}</button>
        {before && <button type="button" className={buttonSecondary} onClick={() => { onChange(before); setBefore(null); setSaid('The change was undone.') }}>Undo</button>}
      </div>
      {said && <p role="status" className="text-xs text-ink-800">{said}</p>}
    </form>
  )
}
