/**
 * Which blocks are hidden on the canvas. A view state only: nothing here reaches the component model, the MJML
 * or the saved project, so a hidden block still ships in the email. It resets on reload, which is intended.
 */
export const HIDDEN_ATTRIBUTE = 'data-cep-hidden'

export function toggleHidden(hidden: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(hidden)
  if (!next.delete(id)) next.add(id)
  return next
}

/** Drops ids whose component has gone, so a deleted block does not hide a later one that reuses its id. */
export function pruneHidden(hidden: ReadonlySet<string>, liveIds: Iterable<string>): Set<string> {
  const live = new Set(liveIds)
  return new Set([...hidden].filter((id) => live.has(id)))
}

export function sameHidden(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id))
}
