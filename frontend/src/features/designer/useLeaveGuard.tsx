/**
 * Confirms before unsaved work is thrown away, on every route out: in-app navigation, the browser Back
 * button and closing the tab.
 *
 * react-router's useBlocker is not an option here: it calls useDataRouterContext, which throws outside a
 * data router, and the app mounts <BrowserRouter>. So Back is caught with one sentinel history entry —
 * while there are unsaved changes the editor holds an extra entry for its own URL, and popping it opens
 * the dialog instead of leaving.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { buttonDanger, buttonPrimary } from '@/components/Form'
import { Modal } from '@/components/Modal'

const MARK = 'cepLeaveGuard'

const isMarked = () => Boolean((window.history.state as Record<string, unknown> | null)?.[MARK])

export function useLeaveGuard(dirty: boolean, fallbackLeave?: () => void): { requestLeave: (proceed: () => void) => void; dialog: ReactNode } {
  const [asking, setAsking] = useState(false)
  const pending = useRef<(() => void) | null>(null)
  const dirtyRef = useRef(dirty)
  const armed = useRef(false)
  // set while we are deliberately leaving, so our own navigation never re-opens the dialog
  const leaving = useRef(false)
  // false when the editor is the first entry in the tab: there is then nothing behind the sentinel to go back to
  const hadPrevious = useRef(true)
  const fallback = useRef(fallbackLeave)
  useEffect(() => {
    fallback.current = fallbackLeave
  })
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  const requestLeave = useCallback((proceed: () => void) => {
    if (!dirtyRef.current) {
      proceed()
      return
    }
    pending.current = proceed
    setAsking(true)
  }, [])

  useEffect(() => {
    if (dirty) {
      if (!armed.current && !isMarked()) {
        hadPrevious.current = window.history.length > 1
        window.history.pushState({ ...window.history.state, [MARK]: true }, '')
        armed.current = true
      }
      return
    }
    // saved: drop the sentinel so Back goes where the reader expects
    if (armed.current) {
      armed.current = false
      if (isMarked() && !leaving.current) window.history.go(-1)
    }
  }, [dirty])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current && !leaving.current) event.preventDefault()
    }
    const onPopState = () => {
      if (!dirtyRef.current || leaving.current || !armed.current) return
      // the sentinel has just been consumed; put it back and ask before really going
      window.history.pushState({ ...window.history.state, [MARK]: true }, '')
      pending.current = () => {
        // past the sentinel and past this page — unless the editor opened the tab, where there is no such entry
        if (hadPrevious.current) window.history.go(-2)
        else fallback.current?.()
      }
      setAsking(true)
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  // On unmount only un-mark the entry: replaceState is synchronous, so StrictMode's double mount cannot
  // race it the way an async history.go would.
  useEffect(
    () => () => {
      if (armed.current && isMarked() && !leaving.current) {
        window.history.replaceState({ ...window.history.state, [MARK]: false }, '')
      }
      armed.current = false
    },
    [],
  )

  const keepEditing = () => {
    pending.current = null
    setAsking(false)
  }

  const leave = () => {
    const proceed = pending.current
    pending.current = null
    // disarm everything before navigating: nothing below should prompt a second time
    leaving.current = true
    armed.current = false
    setAsking(false)
    proceed?.()
  }

  const dialog = asking ? (
    <Modal
      title="Leave without saving?"
      onClose={keepEditing}
      footer={
        <>
          {/* the editors keep their solid blue secondary (approved exact copy) */}
          <button type="button" autoFocus className={buttonPrimary} onClick={keepEditing}>
            Keep Editing
          </button>
          <button type="button" className={buttonDanger} onClick={leave}>
            Leave Without Saving
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-800">You have unsaved changes to this template. Leaving discards them.</p>
    </Modal>
  ) : null

  return { requestLeave, dialog }
}
