/**
 * The email's code: its MJML — the source the server builds the sent HTML from — and that HTML, read-only.
 * People who can edit the template may also edit the MJML, as an advanced step behind a one-time warning.
 * Knows nothing about GrapesJS: checking and applying the code are the caller's.
 */
import { useId, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { Notice } from '@/components/Notice'
import { Tabs } from '@/components/Tabs'
import { tabId, tabPanelId } from '@/components/tabIds'

import { adjustedNote } from './codeAdjustments'
import type { CheckResult } from './codeChecks'
import {
  APPLY_HINT, APPLY_LABEL, CLOSE_LABEL, CODE_NOTE, CODE_TITLE, COPIED_TOAST, COPY_FAILED_TOAST, COPY_LABEL, DISCARD_CONFIRM,
  DISCARD_LABEL, DISCARD_NOTE, DISCARD_TITLE, DOWNLOAD_HTML_LABEL, DOWNLOAD_MJML_LABEL, EDITOR_LABEL, EDIT_LABEL, GATE_CANCEL,
  FORMATTED_HINT, GATE_CONFIRM, GATE_NOTE, GATE_TITLE, HIDE_DETAILS, HTML_TAB, KEEP_EDITING, MJML_TAB, REPLACE_WARNING, SHOW_DETAILS,
  codeGateSeen, rememberCodeGate,
} from './codeCopy'
import { CodeEditor, type CodeEditorHandle } from './CodeEditor'
import { formatMjml } from './formatMjml'

type CodeTab = 'mjml' | 'html'

const TABS = [
  { id: 'mjml' as const, label: MJML_TAB },
  { id: 'html' as const, label: HTML_TAB },
]

const READ = 'max-h-[60vh] overflow-auto rounded-lg border border-line bg-surface-subtle p-3 font-mono text-xs leading-relaxed text-ink-900 whitespace-pre-wrap break-all'

export interface CodeDialogProps {
  mjml: string
  html: string
  /** false for view-only readers and archived templates: MJML is shown, never edited */
  canEdit: boolean
  /** the Apply checks, in order; never changes the design */
  onCheck: (text: string) => CheckResult
  /** puts checked code into the design; resolves with what the editor adjusted, if anything */
  onApply: (text: string) => Promise<{ changes: string[] }>
  onDownloadHtml: () => void
  /** handed the formatted MJML the reader is looking at */
  onDownloadMjml: (mjml: string) => void
  onToast: (tone: 'success' | 'error', title: string, detail?: string) => void
  onClose: () => void
}

type Pending = { kind: 'gate' } | { kind: 'discard'; then: () => void } | null

export function CodeDialog({ mjml, html, canEdit, onCheck, onApply, onDownloadHtml, onDownloadMjml, onToast, onClose }: CodeDialogProps) {
  const idPrefix = useId()
  const problemId = useId()
  const [tab, setTab] = useState<CodeTab>('mjml')
  const [draft, setDraft] = useState<string | null>(null)
  const [problem, setProblem] = useState<Exclude<CheckResult, { ok: true }> | null>(null)
  const [details, setDetails] = useState(false)
  const [adjusted, setAdjusted] = useState<string[]>([])
  const [applying, setApplying] = useState(false)
  const [pending, setPending] = useState<Pending>(null)
  const editor = useRef<CodeEditorHandle>(null)

  // the editor writes MJML on one line; it is read, copied, downloaded and edited one element per line
  const shown = useMemo(() => formatMjml(mjml), [mjml])
  const editing = draft !== null
  const changed = editing && draft !== shown

  const stopEditing = () => {
    setDraft(null)
    setProblem(null)
    setDetails(false)
  }
  /** leaving edit mode with changes that were never applied asks first */
  const leaveEditing = (then: () => void) => {
    if (changed) setPending({ kind: 'discard', then })
    else {
      stopEditing()
      then()
    }
  }

  const startEditing = () => {
    setAdjusted([])
    setDraft(shown)
  }
  const requestEdit = () => {
    if (codeGateSeen()) startEditing()
    else setPending({ kind: 'gate' })
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      onToast('success', COPIED_TOAST)
    } catch (error) {
      onToast('error', COPY_FAILED_TOAST, error instanceof Error ? error.message : undefined)
    }
  }

  const apply = async () => {
    if (draft === null || !changed || applying) return
    // compiling a large email takes a moment: the button says so before the work starts, not after
    setApplying(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const result = onCheck(draft)
    if (!result.ok) {
      // what the person typed stays exactly as it is; only the message changes
      setProblem(result)
      setDetails(false)
      setApplying(false)
      return
    }
    try {
      const { changes } = await onApply(draft)
      stopEditing()
      setAdjusted(changes)
    } finally {
      setApplying(false)
    }
  }

  // the editors are an approved exact copy: their secondary buttons stay solid blue, the primary look
  const footer =
    editing ?
      <>
        <Button variant="primary" onClick={() => leaveEditing(() => {})}>{DISCARD_LABEL}</Button>
        <Button variant="primary" softDisabled={!changed} title={changed ? undefined : APPLY_HINT} loading={applying} onClick={() => void apply()}>
          {APPLY_LABEL}
        </Button>
      </>
    : <>
        <Button variant="primary" onClick={onClose}>{CLOSE_LABEL}</Button>
        <Button variant="primary" onClick={() => void copy(tab === 'mjml' ? shown : html)}>{COPY_LABEL}</Button>
        {tab === 'mjml' ?
          <>
            <Button variant="primary" onClick={() => onDownloadMjml(shown)}>{DOWNLOAD_MJML_LABEL}</Button>
            {canEdit ? <Button variant="primary" onClick={requestEdit}>{EDIT_LABEL}</Button> : null}
          </>
        : <Button variant="primary" onClick={onDownloadHtml}>{DOWNLOAD_HTML_LABEL}</Button>}
      </>

  return (
    <>
      <Modal title={CODE_TITLE} subtitle={CODE_NOTE} onClose={() => leaveEditing(onClose)} size="lg" footer={footer}>
        <div className="-mt-1 mb-3 flex border-b border-line">
          <Tabs
            label={CODE_TITLE}
            tabs={TABS}
            value={tab}
            idPrefix={idPrefix}
            size="sm"
            onChange={(next) => {
              if (next === tab) return
              if (editing) leaveEditing(() => setTab(next))
              else setTab(next)
            }}
          />
        </div>

        <div role="tabpanel" id={tabPanelId(idPrefix, tab)} aria-labelledby={tabId(idPrefix, tab)}>
          {tab === 'mjml' && editing ?
            <div className="flex flex-col gap-2">
              {problem ?
                <div id={problemId}>
                  <Notice
                    tone="error"
                    layout="box"
                    action={
                      problem.details.length > 0 ?
                        <Button variant="link" size="sm" aria-expanded={details} onClick={() => setDetails((was) => !was)}>
                          {details ? HIDE_DETAILS : SHOW_DETAILS}
                        </Button>
                      : undefined
                    }
                  >
                    <ProblemLine problem={problem} onGoToLine={(line) => editor.current?.goToLine(line)} />
                    {details ?
                      <ul className="mt-1 list-disc pl-4 font-mono">
                        {problem.details.map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    : null}
                  </Notice>
                </div>
              : null}
              <CodeEditor
                ref={editor}
                label={EDITOR_LABEL}
                value={draft}
                invalid={problem !== null}
                describedBy={problem ? problemId : undefined}
                onChange={setDraft}
              />
              <p className="text-xs text-ink-800">{REPLACE_WARNING}</p>
            </div>
          : <div className="flex flex-col gap-2">
              {tab === 'mjml' && adjusted.length > 0 ?
                <Notice tone="info" layout="box">
                  {adjustedNote(adjusted)}
                </Notice>
              : null}
              <pre aria-label={tab === 'mjml' ? MJML_TAB : HTML_TAB} tabIndex={0} className={READ}>
                {tab === 'mjml' ? shown : html}
              </pre>
              {tab === 'mjml' ? <p className="text-xs text-ink-800">{FORMATTED_HINT}</p> : null}
            </div>
          }
        </div>
      </Modal>

      {pending?.kind === 'gate' ?
        <Modal
          title={GATE_TITLE}
          size="lg"
          onClose={() => setPending(null)}
          footer={
            <>
              <Button variant="primary" autoFocus onClick={() => setPending(null)}>
                {GATE_CANCEL}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  rememberCodeGate()
                  setPending(null)
                  startEditing()
                }}
              >
                {GATE_CONFIRM}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-800">{GATE_NOTE}</p>
        </Modal>
      : null}

      {pending?.kind === 'discard' ?
        <Modal
          title={DISCARD_TITLE}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button variant="primary" autoFocus onClick={() => setPending(null)}>
                {KEEP_EDITING}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const { then } = pending
                  setPending(null)
                  stopEditing()
                  then()
                }}
              >
                {DISCARD_CONFIRM}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-800">{DISCARD_NOTE}</p>
        </Modal>
      : null}
    </>
  )
}

/** "Line 8: …" with the line as a button that takes the caret there, then "and 2 more problems". */
function ProblemLine({ problem, onGoToLine }: { problem: Exclude<CheckResult, { ok: true }>; onGoToLine: (line: number) => void }) {
  const { line, message, more } = problem
  const prefix = line ? `Line ${line}` : null
  const rest = prefix && message.startsWith(`${prefix}:`) ? message.slice(prefix.length) : message
  return (
    <p>
      {line ?
        <>
          <button type="button" className="font-semibold underline" onClick={() => onGoToLine(line)}>
            {prefix ?? `Line ${line}`}
          </button>
          {rest.startsWith(':') ? rest : ` ${rest}`}
        </>
      : message}
      {more ? ` ${more}` : null}
    </p>
  )
}
