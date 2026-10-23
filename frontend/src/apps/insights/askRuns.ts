/** AI Reports → Run Details: the runs of this visit, kept in the browser tab (sessionStorage) so they are still there after Open in Editor and back. */
import type { AskResult, AskStep } from './types'

const KEY = 'insights.ai.runs'
const KEPT = 20

export interface Run {
  /** the progress id the prompt was sent with */
  id: string
  prompt: string
  name: string | null
  started_at: number
  result?: { id: string; kind: AskResult['kind']; name: string | null; duration_ms: number; tokens: { in: number; out: number } | null; model: string; steps: AskStep[]; message: string | null }
  failure?: string
  report?: { id: string; name: string }
}

export function readRuns(): Run[] {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(KEY) ?? '[]')
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

function kept(runs: Run[]): Run[] {
  const next = runs.slice(0, KEPT)
  try { window.sessionStorage.setItem(KEY, JSON.stringify(next)) } catch { /* the runs stay for this page only */ }
  return next
}

export const addRun = (runs: Run[], run: Run) => kept([run, ...runs.filter((other) => other.id !== run.id)])
export const finishRun = (runs: Run[], id: string, change: Partial<Run>) => kept(runs.map((run) => (run.id === id ? { ...run, ...change } : run)))
export const resultOf = (reply: AskResult): Run['result'] => ({
  id: reply.id, kind: reply.kind, name: reply.name ?? null, duration_ms: reply.duration_ms, tokens: reply.tokens ?? null, model: reply.model.label, steps: reply.steps ?? [], message: reply.message,
})
