/** The strips that sit between the tab bar and the canvas: an older version, read-only access, a lost race. */
import { Eye, History } from 'lucide-react'

import { Notice } from '@/components/Notice'

import { BACK_TO_LATEST, CONFLICT_NOTE, LOAD_LATEST, READ_ONLY_NOTE, oldVersionNote } from './versionNotes'

const STRIP_BUTTON = 'inline-flex h-7 shrink-0 items-center rounded-sm border px-3 text-xs font-semibold transition-colors duration-base ease-standard'
const WARNING_BUTTON = `${STRIP_BUTTON} border-warning bg-surface text-warning-text hover:bg-surface-subtle`
const DANGER_BUTTON = `${STRIP_BUTTON} border-danger bg-surface text-danger-text hover:bg-surface-subtle`
const DISABLED_BUTTON = `${STRIP_BUTTON} cursor-not-allowed border-line bg-line-subtle text-ink-300`

export function VersionStrip({ version, busy = false, onBackToLatest }: { version: number; busy?: boolean; onBackToLatest: () => void }) {
  return (
    <Notice
      tone="warning"
      icon={History}
      action={
        <button type="button" aria-disabled={busy || undefined} onClick={busy ? undefined : onBackToLatest} className={busy ? DISABLED_BUTTON : WARNING_BUTTON}>
          {BACK_TO_LATEST}
        </button>
      }
    >
      {oldVersionNote(version)}
    </Notice>
  )
}

export function ReadOnlyStrip() {
  return (
    <Notice tone="info" icon={Eye} iconClass="text-ink-700">
      {READ_ONLY_NOTE}
    </Notice>
  )
}

export function ConflictStrip({ busy = false, onLoadLatest }: { busy?: boolean; onLoadLatest: () => void }) {
  return (
    <Notice
      tone="error"
      action={
        <button type="button" aria-disabled={busy || undefined} onClick={busy ? undefined : onLoadLatest} className={busy ? DISABLED_BUTTON : DANGER_BUTTON}>
          {LOAD_LATEST}
        </button>
      }
    >
      {CONFLICT_NOTE}
    </Notice>
  )
}
