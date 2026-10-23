/**
 * AI Reports → Prompt History (docs/mockups/ai-reports-page.html, option A): the person's prompts of the last 90 days, newest first,
 * in a list that scrolls and loads older ones as it reaches the end. Show hides or shows the list (remembered per browser); Clear
 * History takes the prompts off the list after a confirmation (they still count in the month's prompts); Use Again puts a prompt back
 * in the box; the pencil renames the report a prompt became, or its draft not opened yet.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'

import { IconButton } from '@/components/Button'
import { buttonPrimary, buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { Spinner } from '@/components/States'
import { Switch } from '@/components/Switch'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { formatNumber, formatRelative } from '@/lib/format'
import { assistantApi, keys } from '../api'
import type { AssistantRecent } from '../types'

const SHOW_KEY = 'insights.ai.history'

function rememberedShow(): boolean {
  try { return window.localStorage.getItem(SHOW_KEY) !== 'hidden' } catch { return true }
}

const OUTCOME_WORDS: Record<AssistantRecent['outcome'], string> = { DRAFT: 'Not saved', QUESTION: 'Asked a question', NO_FIELD: 'No field for it', FAILED: 'Did not answer' }

export function PromptHistory({ onUse }: { onUse: (prompt: string) => void }) {
  const client = useQueryClient()
  const toast = useToast()
  const [shown, setShown] = useState(rememberedShow)
  const [confirming, setConfirming] = useState(false)
  const list = useRef<HTMLOListElement>(null)
  const end = useRef<HTMLLIElement>(null)
  const history = useInfiniteQuery({
    queryKey: keys.history,
    queryFn: ({ pageParam, signal }) => assistantApi.history(pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.more ? last.prompts.at(-1)?.id : undefined),
    enabled: shown,
  })
  const clear = useMutation({
    mutationFn: assistantApi.clearHistory,
    onSuccess: ({ cleared }) => {
      setConfirming(false)
      toast.success('History cleared', `${formatNumber(cleared)} prompt${cleared === 1 ? '' : 's'} left the list.`)
      void client.invalidateQueries({ queryKey: keys.assistant })
    },
    onError: (error) => toast.failure(error, 'The history was not cleared'),
  })
  const prompts = history.data?.pages.flatMap((page) => page.prompts) ?? []
  const clearable = history.data?.pages[0]?.clearable ?? false
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = history

  // reaching the end of the list loads the older prompts
  useEffect(() => {
    if (!hasNextPage || !end.current || typeof IntersectionObserver === 'undefined') return
    const watcher = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage() }, { root: list.current })
    watcher.observe(end.current)
    return () => watcher.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, prompts.length])

  const show = (next: boolean) => {
    setShown(next)
    try { window.localStorage.setItem(SHOW_KEY, next ? 'shown' : 'hidden') } catch { /* shown again next visit */ }
  }

  return (
    <section aria-label="Prompt History" className="flex flex-col rounded-lg border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-subtle px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink-900">Prompt History</h2>
        <span className="text-xs text-ink-800">Last 90 days, newest first</span>
        <span className="ml-auto flex items-center gap-3">
          <Switch checked={shown} onChange={show} label="Show" ariaLabel="Show Prompt History" />
          {shown && clearable && prompts.length > 0 && (
            <button type="button" onClick={() => setConfirming(true)} className="text-xs font-medium text-link hover:underline">Clear History…</button>
          )}
        </span>
      </header>
      {!shown ? (
        <p className="px-4 py-3 text-xs text-ink-800">Hidden. Your earlier prompts are kept; switch Show on to see them.</p>
      ) : history.isPending ? (
        <div className="px-4 py-3"><Spinner size="sm" label="Loading your prompts" /></div>
      ) : history.isError ? (
        <p className="px-4 py-3 text-xs text-danger-text">Your prompts could not be loaded.</p>
      ) : prompts.length === 0 ? (
        <p className="px-4 py-3 text-xs text-ink-800">No prompts yet. Each prompt you send shows here, newest first.</p>
      ) : (
        <ol ref={list} aria-label="Your prompts" className="max-h-[28rem] overflow-y-auto px-4">
          {prompts.map((item) => <HistoryRow key={item.id} item={item} onUse={onUse} />)}
          {hasNextPage && (
            <li ref={end} className="flex justify-center border-t border-line-subtle py-2">
              {isFetchingNextPage
                ? <Spinner size="sm" label="Loading older prompts" />
                : <button type="button" onClick={() => void fetchNextPage()} className="text-xs font-medium text-link hover:underline">Show Older Prompts</button>}
            </li>
          )}
        </ol>
      )}
      {confirming && (
        <Modal title="Clear your prompt history?" onClose={() => setConfirming(false)} footer={(
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonSecondary} onClick={() => setConfirming(false)}>Cancel</button>
            <button type="button" className={buttonPrimary} onClick={() => clear.mutate()} disabled={clear.isPending}>{clear.isPending ? 'Clearing…' : 'Clear History'}</button>
          </div>
        )}>
          <p className="text-sm text-ink-900">Your prompts leave this list. The reports they became are not touched, and the month’s prompt count stays as it is.</p>
        </Modal>
      )}
    </section>
  )
}

function HistoryRow({ item, onUse }: { item: AssistantRecent; onUse: (prompt: string) => void }) {
  const client = useQueryClient()
  const name = item.report_name ?? item.draft_name ?? null
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name ?? '')
  const [error, setError] = useState<string | null>(null)
  const rename = useMutation({
    mutationFn: (next: string) => assistantApi.rename(item.id, next),
    onSuccess: () => {
      setEditing(false)
      setError(null)
      void client.invalidateQueries({ queryKey: keys.history })
      void client.invalidateQueries({ queryKey: ['insights', 'reports'] })
    },
    onError: (failure) => setError(failure instanceof ApiError ? failure.message : 'The name was not saved.'),
  })
  const start = () => { setDraft(name ?? ''); setError(null); setEditing(true) }
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); if (draft.trim()) rename.mutate(draft.trim()) }
    else if (event.key === 'Escape') { event.preventDefault(); setEditing(false); setError(null) }
  }
  const tokens = item.tokens_in || item.tokens_out ? `${formatNumber(item.tokens_in ?? 0)} tokens in, ${formatNumber(item.tokens_out ?? 0)} out` : null
  return (
    <li className="flex gap-3 border-t border-line-subtle py-2.5 first:border-t-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {editing ? (
          <div className="flex flex-col gap-0.5">
            <input aria-label="Report name" autoFocus value={draft} maxLength={200} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKey} disabled={rename.isPending}
              className="h-7 w-full max-w-md rounded-control-md border border-focus bg-surface px-2 text-sm text-ink-900 shadow-focus outline-none" />
            <span className="text-xs text-ink-700">Enter to save · Esc to cancel</span>
            {error && <span role="alert" className="text-xs text-danger-text">{error}</span>}
          </div>
        ) : name ? (
          <span className="flex min-w-0 items-center gap-1">
            {item.report_id
              ? <Link to={`/insights/reports/${item.report_id}`} className="truncate text-sm font-semibold text-link hover:underline">{name}</Link>
              : <span className="truncate text-sm font-semibold text-ink-900">{name}</span>}
            <IconButton label={`Rename ${name}`} icon={Pencil} size="xs" onClick={start} />
          </span>
        ) : null}
        <p className="line-clamp-2 text-sm whitespace-pre-line text-ink-900">{item.prompt}</p>
        <p className="text-xs text-ink-800">{[item.model, item.report_id ? 'Saved as a report' : OUTCOME_WORDS[item.outcome], tokens].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs whitespace-nowrap text-ink-700" title={item.created_at}>{formatRelative(item.created_at)}</span>
        <button type="button" onClick={() => onUse(item.prompt)} className="text-xs font-medium text-link hover:underline">Use Again</button>
      </div>
    </li>
  )
}
