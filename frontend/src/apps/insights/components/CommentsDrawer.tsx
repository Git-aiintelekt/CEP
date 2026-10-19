/**
 * Comments: the notes on a report or a dashboard, oldest first, open ones above the resolved. A note may be on the whole, on a
 * tile, or on one value of a chart (an annotation: the chart marks that value). Write one at the bottom; a note started from a
 * right-click or a tile carries what it is on, which its cross takes off. Your own can be changed or deleted; anyone who can open
 * the item resolves a note or opens it again.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, MapPin, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@/components/Button'
import { Drawer } from '@/components/Drawer'
import { buttonPrimary, TextArea } from '@/components/Form'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { formatDateTime } from '@/lib/format'
import { commentsApi, commentsKey, useComments } from '../api'
import type { CommentAnchor, InsightsComment } from '../types'

function anchorWords(anchor: CommentAnchor | null, tileName?: (tileId: string) => string | undefined): string | null {
  if (!anchor) return null
  const parts = [anchor.tile_id ? `On ${tileName?.(anchor.tile_id) ?? 'a tile'}` : null, anchor.field ? `${anchor.tile_id ? '' : 'On '}${anchor.label ?? String(anchor.value)}` : null].filter(Boolean)
  return parts.join(', ')
}

function Note({ comment, onSaved, tileName }: { comment: InsightsComment; onSaved: () => void; tileName?: (tileId: string) => string | undefined }) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(comment.body)
  const change = useMutation({ mutationFn: (patch: { body?: string; resolved?: boolean }) => commentsApi.update(comment.id, patch), onSuccess: () => { setEditing(false); onSaved() }, onError: (e) => toast.failure(e, 'The comment was not changed') })
  const remove = useMutation({ mutationFn: () => commentsApi.remove(comment.id), onSuccess: onSaved, onError: (e) => toast.failure(e, 'The comment was not deleted') })
  const where = anchorWords(comment.anchor, tileName)
  return (
    <li className={`flex flex-col gap-1.5 rounded-md border border-line p-3 ${comment.resolved_at ? 'bg-surface-subtle' : 'bg-surface'}`} aria-label={`Comment by ${comment.author_name}`}>
      <div className="flex items-center gap-2 text-xs text-ink-800">
        <span className="font-semibold text-ink-900">{comment.author_name}</span>
        <span>{formatDateTime(comment.created_at)}{comment.edited_at ? ' · edited' : ''}</span>
        <span className="ml-auto flex items-center gap-0.5">
          <IconButton label={comment.resolved_at ? 'Open again' : 'Resolve'} icon={comment.resolved_at ? RotateCcw : Check} size="xs" onClick={() => change.mutate({ resolved: !comment.resolved_at })} />
          {comment.mine && !editing && <IconButton label="Change" icon={Pencil} size="xs" onClick={() => setEditing(true)} />}
          {comment.can_delete && <IconButton label="Delete" icon={Trash2} size="xs" onClick={() => remove.mutate()} />}
        </span>
      </div>
      {where && <span className="inline-flex w-fit items-center gap-1 rounded-sm bg-fill-subtle px-1.5 py-0.5 text-xs text-ink-800"><MapPin size={12} strokeWidth={1.5} aria-hidden />{where}</span>}
      {editing ? (
        <div className="flex flex-col gap-2">
          <TextArea aria-label="Change the comment" value={body} rows={3} maxLength={2000} onChange={(event) => setBody(event.target.value)} />
          <div className="flex justify-end gap-2">
            <button type="button" className="text-sm font-semibold text-brand-800 hover:underline" onClick={() => { setEditing(false); setBody(comment.body) }}>Cancel</button>
            <button type="button" className={buttonPrimary} disabled={!body.trim() || change.isPending} onClick={() => change.mutate({ body: body.trim() })}>Save</button>
          </div>
        </div>
      ) : <p className="text-sm whitespace-pre-wrap text-ink-900">{comment.body}</p>}
      {comment.resolved_at && <span className="text-xs text-ink-700">Resolved{comment.resolved_by_name ? ` by ${comment.resolved_by_name}` : ''}</span>}
    </li>
  )
}

export function CommentsDrawer({ kind, id, name, anchor, onAnchor, onClose, tileName }: {
  kind: 'report' | 'dashboard'; id: string; name: string
  /** what a new note will be on; null for the whole */
  anchor: CommentAnchor | null
  onAnchor: (anchor: CommentAnchor | null) => void
  onClose: () => void
  tileName?: (tileId: string) => string | undefined
}) {
  const toast = useToast()
  const client = useQueryClient()
  const comments = useComments(kind, id)
  const [body, setBody] = useState('')
  const refresh = () => client.invalidateQueries({ queryKey: commentsKey(kind, id) })
  const add = useMutation({
    mutationFn: () => commentsApi.create({ kind, item_id: id, body: body.trim(), anchor }),
    onSuccess: () => { setBody(''); onAnchor(null); void refresh() },
    onError: (error) => toast.failure(error, 'The comment was not added'),
  })
  const all = comments.data?.comments ?? []
  const open = all.filter((c) => !c.resolved_at)
  const resolved = all.filter((c) => c.resolved_at)
  const where = anchorWords(anchor, tileName)
  return (
    <Drawer title="Comments" eyebrow={name} onClose={onClose}
      footer={comments.data?.ready === false ? undefined : (
        <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); if (body.trim()) add.mutate() }}>
          {where && (
            <span className="inline-flex w-fit items-center gap-1 rounded-sm bg-fill-subtle px-1.5 py-0.5 text-xs text-ink-800">
              <MapPin size={12} strokeWidth={1.5} aria-hidden />{where}
              <button type="button" aria-label="Comment on the whole instead" className="ml-0.5 text-ink-700 hover:text-ink-900" onClick={() => onAnchor(null)}><X size={12} strokeWidth={1.5} aria-hidden /></button>
            </span>
          )}
          <TextArea aria-label="New comment" placeholder="Write a comment" value={body} rows={3} maxLength={2000} onChange={(event) => setBody(event.target.value)} />
          <div className="flex justify-end"><button type="submit" className={buttonPrimary} disabled={!body.trim() || add.isPending}>Add Comment</button></div>
        </form>
      )}>
      {comments.isPending ? <Spinner label="Loading the comments" /> : comments.isError ? <ErrorState error={comments.error} onRetry={() => comments.refetch()} />
        : !comments.data.ready ? <p className="text-sm text-ink-800">Comments need database patch 0062, which is not applied to this workspace yet.</p>
        : all.length === 0 ? <p className="text-sm text-ink-800">No comments yet. Right-click a value on a chart or a table to comment on it, or write about the whole below.</p>
        : (
          <div className="flex flex-col gap-4">
            <ul aria-label="Open comments" className="flex flex-col gap-2">{open.map((c) => <Note key={c.id} comment={c} onSaved={refresh} tileName={tileName} />)}</ul>
            {resolved.length > 0 && (
              <section aria-label="Resolved comments" className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold text-ink-800">Resolved</h3>
                <ul className="flex flex-col gap-2">{resolved.map((c) => <Note key={c.id} comment={c} onSaved={refresh} tileName={tileName} />)}</ul>
              </section>
            )}
          </div>
        )}
    </Drawer>
  )
}
