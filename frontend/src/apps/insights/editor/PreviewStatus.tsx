/**
 * The line pinned under the editor's canvas: how the preview ran (rows, time, where the data came from), Update
 * Automatically, Run Preview while that is off, and Show the SQL. Update Automatically is remembered per browser.
 */
import { Code2, RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { Switch } from '@/components/Switch'

const AUTO_KEY = 'insights.editor.auto'

export function useAutoPreview(): [boolean, (on: boolean) => void] {
  const [auto, setAutoState] = useState(() => {
    try { return window.localStorage.getItem(AUTO_KEY) !== 'off' } catch { return true }
  })
  const setAuto = (on: boolean) => {
    setAutoState(on)
    try { window.localStorage.setItem(AUTO_KEY, on ? 'on' : 'off') } catch { /* no memory of the choice */ }
  }
  return [auto, setAuto]
}

const link = 'inline-flex items-center gap-1.5 font-semibold text-brand-800 hover:underline disabled:cursor-not-allowed disabled:text-ink-300 disabled:no-underline'

export function PreviewStatus({ words, live, auto, onAuto, onRun, onSql }: {
  /** what to say: the run words, Running…, or what is missing */
  words: string
  /** a preview is on screen and shows the latest changes */
  live: boolean
  auto: boolean
  onAuto: (on: boolean) => void
  /** set while Update Automatically is off and there is something to run */
  onRun?: () => void
  /** set when the definition can be shown as SQL */
  onSql?: () => void
}) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-4 border-t border-line bg-surface px-4 text-helper text-ink-800">
      <span role="status" className="flex min-w-0 items-center gap-1.5 truncate">
        {live && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-success" />}
        <span className="truncate">{words}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-4">
        <Switch checked={auto} onChange={onAuto} label="Update Automatically" />
        {!auto && <button type="button" className={link} disabled={!onRun} onClick={onRun}><RefreshCw size={14} strokeWidth={1.5} aria-hidden />Run Preview</button>}
        <button type="button" className={link} disabled={!onSql} onClick={onSql}><Code2 size={14} strokeWidth={1.5} aria-hidden />Show the SQL</button>
      </span>
    </div>
  )
}
