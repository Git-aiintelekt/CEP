/**
 * Everything around the canvas: subject line, save with version lock, findings, preview, tag catalogue, history.
 * Talks to a `DesignerBackend`, so the template page passes the API and the dev playground passes an in-memory one.
 */
import { Eye, PencilRuler } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { NavBar } from '@/components/NavBar'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import { formatUtcClock } from '@/lib/format'
import type { Design, DesignFindings, DesignSaveInput, DesignVersion, PersonalizationTag } from '@/lib/types'
import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { AUTOSAVE_MS, autosaveDue } from './autosave'
import { EditorFrame, type EditorTabDef } from './EditorFrame'
import { EmailDesigner, type DesignerAsset, type EmailDesignerHandle } from './EmailDesigner'
import { PREHEADER_ADVISORY, SUBJECT_ADVISORY, SUBJECT_MAX, blockTargetForIssue, blockTargetForLink, computeIssues, summarise, type Issue } from './issues'
import { HistoryMenu } from './HistoryMenu'
import { ErrorsPill, LinksPill, type PillKey } from './IssuePills'
import { ConflictStrip, ReadOnlyStrip, VersionStrip } from './NoticeStrips'
import { extractLinks, imagesWithoutAlt, placeholderImages, type ImageRef, type LinkEntry } from './links'
import { FooterBar, footerNote } from './FooterBar'
import { useLeaveGuard } from './useLeaveGuard'
import { STARTER_MJML } from './starter'
import { asToken } from './tags'
import { HeaderField } from './HeaderField'
import { spamHint } from './spamWords'
import { saveErrorDetail } from './saveErrors'
import { PreviewPane } from './preview/PreviewPane'
import { buildPreview, type PreviewState } from './preview/previewState'
import { insertIntoHeader, type HeaderField as HeaderFieldName } from './tags/insertIntoHeader'
import { useRecentTags } from './tags/useRecentTags'

export interface DesignerBackend {
  save: (input: DesignSaveInput) => Promise<Design>
  loadVersion: (version: number) => Promise<Design>
  listVersions: () => Promise<DesignVersion[]>
  uploadAsset: (file: File) => Promise<DesignerAsset>
  activate?: () => Promise<void>
}

type EditorTab = 'content' | 'preview'

const TABS: EditorTabDef<EditorTab>[] = [
  { id: 'content', label: 'Content', Icon: PencilRuler },
  { id: 'preview', label: 'Preview', Icon: Eye },
]

interface WorkspaceProps {
  templateName: string
  channel: string
  status: string
  design: Design
  tags: PersonalizationTag[]
  assets: DesignerAsset[]
  backend: DesignerBackend
  backTo: string
  readOnly?: boolean
  /** the app's navigation bar down the left edge; the dev playgrounds leave it off */
  showNav?: boolean
}


export function DesignerWorkspace({ templateName, channel, status, design, tags, assets, backend, backTo, readOnly = false, showNav = false }: WorkspaceProps) {
  const editor = useRef<EmailDesignerHandle>(null)
  const [tab, setTab] = useState<EditorTab>('content')
  const [subject, setSubject] = useState(design.subject_line)
  const [preheader, setPreheader] = useState(design.preheader)
  const [saved, setSaved] = useState({ subject: design.subject_line, preheader: design.preheader, version: design.latest_version, shown: design.version_number })
  const [canvasDirty, setCanvasDirty] = useState(false)
  const [canvasTick, setCanvasTick] = useState(0)
  const [restored, setRestored] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(status)
  const [busy, setBusy] = useState<'save' | 'activate' | 'load' | null>(null)
  const [conflict, setConflict] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(() => clockOf(design.saved_at))
  const [versions, setVersions] = useState<DesignVersion[] | null>(null)
  const [versionsFailed, setVersionsFailed] = useState(false)
  const [preview, setPreview] = useState<PreviewState>({ status: 'loading' })
  const [findings, setFindings] = useState<DesignFindings | undefined>(design.findings)
  const [blockers, setBlockers] = useState<Record<string, string> | undefined>(undefined)
  const [links, setLinks] = useState<LinkEntry[]>([])
  const [noAlt, setNoAlt] = useState<ImageRef[]>([])
  const [stale, setStale] = useState<ImageRef[]>([])
  const subjectRef = useRef<HTMLInputElement>(null)
  const preheaderRef = useRef<HTMLInputElement>(null)
  const subjectId = useId()
  const preheaderId = useId()
  const [recentTags, rememberTag] = useRecentTags()
  // a tag the subject or the preheader had no room for, said beneath the field until it is edited again
  const [noRoom, setNoRoom] = useState<{ field: HeaderFieldName; message: string } | null>(null)
  const pills = useSingleDropdown<PillKey>()
  const toast = useToast()
  const navigate = useNavigate()

  const dirty = canvasDirty || restored || subject !== saved.subject || preheader !== saved.preheader
  const guard = useLeaveGuard(dirty, () => navigate(backTo))
  const issues = useMemo(
    () => computeIssues({ channel, subject, preheader, tags, savedVersion: saved.version, dirty, findings, blockers, imagesWithoutAlt: noAlt, placeholderImages: stale }),
    [channel, subject, preheader, tags, saved.version, dirty, findings, blockers, noAlt, stale],
  )

  const summary = useMemo(() => summarise(issues), [issues])
  const flaggedLinks = links.filter((link) => link.flags.length > 0).length
  const note = footerNote(summary, flaggedLinks)

  const refreshLinks = useCallback(() => {
    const mjml = editor.current?.getMjml()
    if (mjml === undefined) return
    setLinks(extractLinks(mjml, tags))
    setNoAlt(imagesWithoutAlt(mjml))
    setStale(placeholderImages(mjml))
  }, [tags])

  // the canvas changes on every keystroke; reading and parsing the MJML is only worth doing once it settles
  useEffect(() => {
    const timer = window.setTimeout(refreshLinks, 400)
    return () => window.clearTimeout(timer)
  }, [canvasTick, restored, saved.shown, refreshLinks])

  const saveNote =
    (saved.shown === 0 ? 'Not saved yet' : `Version ${saved.shown}${saved.shown !== saved.version ? ` of ${saved.version}` : ''}`) +
    (savedAt ? ` · ${savedAt}` : '') +
    (dirty ? ' · unsaved changes' : '')

  async function changeTab(next: EditorTab) {
    setTab(next)
    pills.close({ restoreFocus: false })
    if (next !== 'preview') return
    // An inline edit is still in the contentEditable DOM until it is committed; buildPreview commits it first.
    // A compile that fails or throws replaces whatever was shown before, so a stale email is never left up.
    setPreview({ status: 'loading' })
    setPreview(await buildPreview(editor.current))
  }

  // the edits as they stand; an automatic save that fails remembers this, so the same edits are not retried every half minute
  const editStamp = `${canvasTick}|${subject}|${preheader}`
  const failedStamp = useRef<string | null>(null)

  /** `auto`: the clock's save, which says nothing unless it fails and never toasts a success. */
  async function save(auto = false) {
    if (!editor.current) return
    setBusy('save')
    try {
      await editor.current.commitEdit()
      const snapshot = editor.current.getDesign()
      const result = await backend.save({
        editor_state: snapshot.editor_state as Record<string, unknown>,
        mjml_source: snapshot.mjml_source,
        subject_line: subject,
        preheader,
        base_version: saved.version,
      })
      editor.current.markSaved()
      setRestored(false)
      setSaved({ subject, preheader, version: result.version_number, shown: result.version_number })
      setVersions(null)
      setFindings(result.findings)
      setBlockers(undefined)
      setConflict(false)
      const word = auto ? 'Autosaved' : 'Saved'
      setSavedAt(clockOf(result.saved_at, word) ?? clockOf(new Date().toISOString(), word))
      if (!auto) toast.success(`Saved as version ${result.version_number}`)
      refreshLinks()
    } catch (error) {
      if (auto) failedStamp.current = editStamp
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true)
        toast.error(error.message)
      } else if (error instanceof ApiError && error.status === 400) {
        toast.error('This design cannot be saved yet', saveErrorDetail(error.fieldErrors))
      } else {
        toast.error('Could not save the design', error instanceof Error ? error.message : undefined)
      }
    } finally {
      setBusy(null)
    }
  }

  // Autosave: half a minute after the last edit the draft is saved as a new version, the way the Save button would.
  // The editor's listeners cannot see React state, so the save runs through a ref that always holds the latest one.
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  })
  useEffect(() => {
    if (!autosaveDue({ dirty, readOnly, conflict, restored, busy: busy !== null, stamp: editStamp, failedStamp: failedStamp.current })) return
    const timer = window.setTimeout(() => void saveRef.current(true), AUTOSAVE_MS)
    return () => window.clearTimeout(timer)
  }, [dirty, readOnly, conflict, restored, busy, editStamp])

  async function activate() {
    if (!backend.activate) return
    setBusy('activate')
    try {
      await backend.activate()
      setCurrentStatus('ACTIVE')
      toast.success('Template activated', 'Campaigns can now be published with it.')
    } catch (error) {
      const fieldErrors = error instanceof ApiError ? error.fieldErrors : {}
      const items = Object.values(fieldErrors)
      if (items.length) {
        setBlockers(fieldErrors)
        toast.error('Not ready to activate', `${items.length} ${items.length === 1 ? 'thing' : 'things'} to fix. See the Errors list.`)
      } else {
        toast.error('Could not activate', error instanceof Error ? error.message : undefined)
      }
    } finally {
      setBusy(null)
    }
  }

  /** Fetched when the History menu opens, and again after a save has emptied it. */
  async function fetchVersions() {
    if (versions !== null) return
    setVersionsFailed(false)
    try {
      setVersions(await backend.listVersions())
    } catch {
      setVersionsFailed(true)
    }
  }

  async function loadLatest() {
    try {
      const list = await backend.listVersions()
      const newest = Math.max(...list.map((item) => item.version_number))
      if (Number.isFinite(newest)) loadVersion(newest)
    } catch (error) {
      toast.error('Could not load the latest version', error instanceof Error ? error.message : undefined)
    }
  }

  function loadVersion(number: number) {
    // replacing the canvas discards unsaved work, so it goes through the same guard as leaving
    guard.requestLeave(() => void doLoadVersion(number))
  }

  async function doLoadVersion(number: number) {
    setBusy('load')
    try {
      const older = await backend.loadVersion(number)
      editor.current?.load(older)
      setSubject(older.subject_line)
      setPreheader(older.preheader)
      const isLatest = number === older.latest_version
      setSaved((current) => ({ ...current, version: older.latest_version, shown: number, ...(isLatest ? { subject: older.subject_line, preheader: older.preheader } : {}) }))
      setRestored(!isLatest)
      setFindings(undefined)
      setBlockers(undefined)
      setSavedAt(clockOf(older.saved_at))
      if (isLatest) {
        editor.current?.markSaved()
        setConflict(false)
      }
      refreshLinks()
    } catch (error) {
      toast.error('Could not load that version', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  /** The subject and the preheader take a tag, or an emoji, at the caret, unless it would push them past the server's limit. */
  function insertHeaderText(field: HeaderFieldName, text: string, tagKey?: string) {
    const [input, value, setValue] = field === 'subject' ? [subjectRef.current, subject, setSubject] : [preheaderRef.current, preheader, setPreheader]
    const start = input?.selectionStart ?? value.length
    const end = input?.selectionEnd ?? start
    const next = insertIntoHeader(field, value, start, end, text)
    if ('refused' in next) {
      setNoRoom({ field, message: next.refused })
      input?.focus()
      return
    }
    if (tagKey) rememberTag(tagKey)
    setNoRoom(null)
    setValue(next.value)
    window.setTimeout(() => {
      input?.focus()
      input?.setSelectionRange(next.caret, next.caret)
    }, 0)
  }

  function jumpToIssue(issue: Issue) {
    setTab('content')
    const block = blockTargetForIssue(issue)
    if (block) {
      editor.current?.revealSetting(block)
      return
    }
    if (issue.target.kind !== 'field') return
    const field = issue.target.field === 'subject' ? subjectRef.current : preheaderRef.current
    field?.scrollIntoView({ block: 'nearest' })
    field?.focus()
  }

  /** An anchor written inside a text block is not a block of its own, so that row stays where it is. */
  function jumpToLink(link: LinkEntry) {
    setTab('content')
    const block = blockTargetForLink(link)
    if (block) editor.current?.revealSetting(block)
  }

  const pillBar = (
    <>
      <HistoryMenu
        versions={versions}
        failed={versionsFailed}
        shown={saved.shown}
        latest={saved.version}
        busy={busy !== null}
        controller={pills}
        onOpen={() => void fetchVersions()}
        onLoad={(number) => {
          pills.close({ restoreFocus: false })
          loadVersion(number)
        }}
      />
      <ErrorsPill issues={issues} controller={pills} onJump={jumpToIssue} />
      <LinksPill links={links} tags={tags} controller={pills} onJump={jumpToLink} />
    </>
  )


  const activateReason =
    dirty ? 'Save your changes first.'
    : saved.version === 0 ? 'Save the email once first.'
    : !summary.canContinue ? 'Fix the open errors to continue.'
    : undefined

  const footer = (
    <FooterBar
      note={note.text}
      noteTone={note.tone}
      save={readOnly ? undefined : { onClick: () => void save(), busy: busy === 'save' }}
      primary={
        backend.activate && currentStatus === 'DRAFT' && !readOnly
          ? { label: 'Activate', onClick: () => void activate(), busy: busy === 'activate', disabled: Boolean(activateReason) || busy !== null, disabledReason: activateReason }
          : undefined
      }
    />
  )

  const contentPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-line-subtle bg-surface px-6 py-2.5">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
          <HeaderField
            id={subjectId}
            label="Subject"
            advisory={SUBJECT_ADVISORY}
            max={SUBJECT_MAX}
            inputRef={subjectRef}
            value={subject}
            placeholder="{{first_name}}, your offer is here"
            readOnly={readOnly}
            note={noRoom?.field === 'subject' ? noRoom.message : null}
            hint={spamHint(subject)}
            onChange={(value) => {
              setSubject(value)
              setNoRoom(null)
            }}
            picker={{ tags, channel, recent: recentTags, onPick: (key) => insertHeaderText('subject', asToken(key), key) }}
            onPickEmoji={(emoji) => insertHeaderText('subject', emoji)}
          />
          <HeaderField
            id={preheaderId}
            label="Preheader"
            advisory={PREHEADER_ADVISORY}
            max={SUBJECT_MAX}
            inputRef={preheaderRef}
            value={preheader}
            placeholder="Preview text shown after the subject in the inbox"
            readOnly={readOnly}
            note={noRoom?.field === 'preheader' ? noRoom.message : null}
            onChange={(value) => {
              setPreheader(value)
              setNoRoom(null)
            }}
            picker={{ tags, channel, recent: recentTags, onPick: (key) => insertHeaderText('preheader', asToken(key), key) }}
            onPickEmoji={(emoji) => insertHeaderText('preheader', emoji)}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <EmailDesigner
            ref={editor}
            initialState={design.editor_state}
            initialMjml={design.mjml_source ?? STARTER_MJML}
            tags={tags}
            channel={channel}
            assets={assets}
            onUploadAsset={backend.uploadAsset}
            onDirtyChange={setCanvasDirty}
            onCanvasChange={() => setCanvasTick((tick) => tick + 1)}
            onError={(message, detail) => toast.error(message, detail)}
            onSuccess={(title, detail) => toast.success(title, detail)}
            readOnly={readOnly}
            recentTags={recentTags}
            onTagUsed={rememberTag}
            onPreview={() => void changeTab('preview')}
            exportName={templateName}
          />
        </div>

      </div>
    </div>
  )

  const previewPane = <PreviewPane state={preview} subject={subject} preheader={preheader} tags={tags} />

  return (
    <>
      {guard.dialog}
      <EditorFrame
      name={templateName}
      status={currentStatus}
      nav={
        showNav ?
          <NavBar
            onNavigate={(to, event) => {
              event.preventDefault()
              guard.requestLeave(() => navigate(to))
            }}
          />
        : undefined
      }
      saveNote={saveNote}
      saveNoteTone={dirty && !readOnly ? 'warning' : 'default'}
      backTo={backTo}
      onBack={(event) => {
        event.preventDefault()
        guard.requestLeave(() => navigate(backTo))
      }}
      tabs={TABS}
      tab={tab}
      onTabChange={(next) => void changeTab(next)}
      tabBarEnd={pillBar}
      notice={
        <>
          {readOnly && <ReadOnlyStrip />}
          {conflict && <ConflictStrip busy={busy !== null} onLoadLatest={() => void loadLatest()} />}
          {saved.shown > 0 && saved.shown !== saved.version && <VersionStrip version={saved.shown} busy={busy !== null} onBackToLatest={() => loadVersion(saved.version)} />}
        </>
      }
      footer={footer}
      panes={[
        { id: 'content', content: contentPane },
        { id: 'preview', content: previewPane, scrolls: true },
      ]}
      />
    </>
  )
}

/** "Saved 06:38 UTC" — the zone is always spelled out, because the reader's is not the workspace's. */
function clockOf(iso: string | null | undefined, word = 'Saved'): string | null {
  const clock = formatUtcClock(iso)
  return clock === null ? null : `${word} ${clock}`
}

