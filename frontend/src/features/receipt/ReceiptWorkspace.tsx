/**
 * The E-Receipt editor: Outer Design, Receipt Layout and Preview & Test around one template. It holds two things
 * the server versions separately — the outer design and the receipt layout — and saves them together.
 * Talks to a `ReceiptBackend`, so the template page passes the API and the dev playground passes an in-memory one.
 */
import { LayoutTemplate, MonitorSmartphone, ReceiptText } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { NavBar } from '@/components/NavBar'
import { useToast } from '@/components/Toast'
import { EditorFrame, type EditorTabDef } from '@/features/designer/EditorFrame'
import type { DesignerAsset, EmailDesignerHandle } from '@/features/designer/EmailDesigner'
import { FooterBar } from '@/features/designer/FooterBar'
import { HistoryMenu } from '@/features/designer/HistoryMenu'
import type { PillKey } from '@/features/designer/IssuePills'
import { ConflictStrip, ReadOnlyStrip, VersionStrip } from '@/features/designer/NoticeStrips'
import { saveErrorDetail } from '@/features/designer/saveErrors'
import { useRecentTags } from '@/features/designer/tags/useRecentTags'
import { useLeaveGuard } from '@/features/designer/useLeaveGuard'
import type { ReceiptSlotPreset } from '@/features/designer/inspector/receiptSettings'
import { ApiError } from '@/lib/api'
import { formatUtcClock, titleCase } from '@/lib/format'
import type { CodeSample, CodeSampleRequest, Design, DesignSaveInput, DesignVersion, PersonalizationTag, ReceiptLayout, ReceiptLayoutSaveInput } from '@/lib/types'
import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { OuterDesignPane } from './OuterDesignPane'
import { PreviewTestPane } from './PreviewTestPane'
import { ReceiptLayoutPane, type ReceiptLayoutConfig } from './ReceiptLayoutPane'
import { designHasFooter, type ReceiptCheckSummary } from './receiptChecks'
import { combinedFor, compileOuter, previewMessage, NOT_READY, type OuterEmail } from './receiptCombined'
import { defaultSectionsFor } from './receiptPresets'
import { DESIGN_NAME, LAYOUT_NAME, conflictNote, olderNote } from './receiptWorkspaceCopy'
import { RECEIPT_STARTER_MJML } from './receiptStarter'
import type { SampleTransaction } from './sampleReceiptData'

export interface ReceiptBackend {
  saveDesign: (input: DesignSaveInput) => Promise<Design>
  loadDesignVersion: (version: number) => Promise<Design>
  listDesignVersions: () => Promise<DesignVersion[]>
  saveReceiptLayout: (input: ReceiptLayoutSaveInput) => Promise<ReceiptLayout>
  loadReceiptLayoutVersion: (version: number) => Promise<ReceiptLayout>
  listReceiptLayoutVersions: () => Promise<DesignVersion[]>
  uploadAsset: (file: File) => Promise<DesignerAsset>
  activate?: () => Promise<void>
  /** the workspace has Barcodes and QR codes: draws a code block's sample, and puts the two blocks in the palette */
  sampleCode?: (request: CodeSampleRequest) => Promise<CodeSample>
}

type ReceiptTab = 'outer' | 'layout' | 'preview'

const TABS: EditorTabDef<ReceiptTab>[] = [
  { id: 'outer', label: titleCase(DESIGN_NAME), Icon: LayoutTemplate },
  { id: 'layout', label: titleCase(LAYOUT_NAME), Icon: ReceiptText },
  { id: 'preview', label: 'Preview & Test', Icon: MonitorSmartphone },
]

interface ReceiptWorkspaceProps {
  templateName: string
  status: string
  design: Design
  receiptLayout: ReceiptLayout
  tags: PersonalizationTag[]
  assets: DesignerAsset[]
  backend: ReceiptBackend
  backTo: string
  readOnly?: boolean
  /** the app's navigation bar down the left edge; the dev playground leaves it off */
  showNav?: boolean
}

/** Where a versioned resource stands: the newest version that exists, and the one on screen. */
interface Saved {
  version: number
  shown: number
}

const configOf = (layout: Pick<ReceiptLayout, keyof ReceiptLayoutConfig>): ReceiptLayoutConfig => ({
  layout_preset: layout.layout_preset, sections: layout.sections, custom_html: layout.custom_html, custom_css: layout.custom_css,
})
const sameConfig = (a: ReceiptLayoutConfig, b: ReceiptLayoutConfig) => JSON.stringify(a) === JSON.stringify(b)

/** "v3", "v2 of 4", or "not saved" when nothing has been. */
const versionText = ({ version, shown }: Saved) => (shown === 0 ? 'not saved' : `v${shown}${shown !== version ? ` of ${version}` : ''}`)

export function ReceiptWorkspace({ templateName, status, design, receiptLayout, tags, assets, backend, backTo, readOnly = false, showNav = false }: ReceiptWorkspaceProps) {
  const editor = useRef<EmailDesignerHandle>(null)
  const [tab, setTab] = useState<ReceiptTab>('outer')
  const [currentStatus, setCurrentStatus] = useState(status)
  const [busy, setBusy] = useState<'save' | 'activate' | 'load' | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(() => clockOf(latestOf(design.saved_at, receiptLayout.saved_at)))
  const pills = useSingleDropdown<PillKey>()
  const toast = useToast()
  const navigate = useNavigate()
  const [recentTags, rememberTag] = useRecentTags()

  // the outer design: the canvas holds the content, this holds where it stands
  const [header, setHeader] = useState({ subject: design.subject_line, preheader: design.preheader })
  const [designSaved, setDesignSaved] = useState<Saved>({ version: design.latest_version, shown: design.version_number })
  const [canvasDirty, setCanvasDirty] = useState(false)
  const [canvasTick, setCanvasTick] = useState(0)
  const [designRestored, setDesignRestored] = useState(false)
  const [designConflict, setDesignConflict] = useState(false)
  const [designVersions, setDesignVersions] = useState<DesignVersion[] | null>(null)
  const [designVersionsFailed, setDesignVersionsFailed] = useState(false)

  // the receipt layout: a controlled value, compared against what was last saved
  const [layout, setLayout] = useState<ReceiptLayoutConfig>(() => configOf(receiptLayout))
  const [layoutSaved, setLayoutSaved] = useState<Saved & { config: ReceiptLayoutConfig }>(() => ({
    config: configOf(receiptLayout), version: receiptLayout.latest_version, shown: receiptLayout.version_number,
  }))
  const [layoutRestored, setLayoutRestored] = useState(false)
  const [layoutConflict, setLayoutConflict] = useState(false)
  const [layoutVersions, setLayoutVersions] = useState<DesignVersion[] | null>(null)
  const [layoutVersionsFailed, setLayoutVersionsFailed] = useState(false)

  // Preview & test: the outer design compiled when the tab opens, the footer read as the canvas settles
  const [outer, setOuter] = useState<OuterEmail>({ ready: false, message: previewMessage(NOT_READY) })
  const [hasFooterBlock, setHasFooterBlock] = useState(() => designHasFooter(design.mjml_source ?? RECEIPT_STARTER_MJML))
  const [checks, setChecks] = useState<ReceiptCheckSummary | null>(null)

  const designDirty = canvasDirty || designRestored
  const layoutDirty = layoutRestored || !sameConfig(layout, layoutSaved.config)
  const dirty = designDirty || layoutDirty
  const guard = useLeaveGuard(dirty, () => navigate(backTo))

  const refreshFooter = useCallback(() => {
    const mjml = editor.current?.getMjml()
    if (mjml !== undefined) setHasFooterBlock(designHasFooter(mjml))
  }, [])

  // the canvas changes on every keystroke; reading the MJML is only worth doing once it settles
  useEffect(() => {
    const timer = window.setTimeout(refreshFooter, 400)
    return () => window.clearTimeout(timer)
  }, [canvasTick, designRestored, designSaved.shown, refreshFooter])

  const renderCombinedHtml = useCallback((transaction: SampleTransaction) => combinedFor(outer, layout.sections, transaction), [outer, layout.sections])

  const saveNote =
    `${DESIGN_NAME} ${versionText(designSaved)} · ${LAYOUT_NAME.toLowerCase()} ${versionText(layoutSaved)}` +
    (savedAt ? ` · ${savedAt}` : '') +
    (dirty ? ' · unsaved changes' : '')

  async function changeTab(next: ReceiptTab) {
    setTab(next)
    pills.close({ restoreFocus: false })
    if (next !== 'preview') return
    // text still being typed on the canvas is committed first, so the preview is the design as it stands
    await editor.current?.commitEdit()
    setOuter(compileOuter(editor.current))
    refreshFooter()
  }

  function applyPreset(preset: ReceiptSlotPreset) {
    setLayout((current) => ({ ...current, layout_preset: preset, sections: defaultSectionsFor(preset) }))
  }

  /** Each part is saved when it has changed or has never been saved; with nothing changed, both are. */
  async function save() {
    if (!editor.current) return
    const handle = editor.current
    const neither = !designDirty && !layoutDirty
    const saveDesign = neither || designDirty || designSaved.version === 0
    const saveLayout = neither || layoutDirty || layoutSaved.version === 0
    setBusy('save')
    try {
      await handle.commitEdit()
      const snapshot = handle.getDesign()
      const config = layout
      const [designResult, layoutResult] = await Promise.allSettled([
        saveDesign ?
          backend.saveDesign({
            editor_state: snapshot.editor_state as Record<string, unknown>, mjml_source: snapshot.mjml_source,
            subject_line: header.subject, preheader: header.preheader, base_version: designSaved.version,
          })
        : Promise.resolve(null),
        saveLayout ? backend.saveReceiptLayout({ ...config, base_version: layoutSaved.version }) : Promise.resolve(null),
      ])

      const done: string[] = []
      if (designResult.status === 'fulfilled' && designResult.value) {
        const result = designResult.value
        handle.markSaved()
        setDesignRestored(false)
        setDesignSaved({ version: result.version_number, shown: result.version_number })
        setDesignConflict(false)
        setDesignVersions(null)
        done.push(`${DESIGN_NAME} version ${result.version_number}`)
      }
      if (layoutResult.status === 'fulfilled' && layoutResult.value) {
        const result = layoutResult.value
        setLayoutRestored(false)
        setLayoutSaved({ config, version: result.version_number, shown: result.version_number })
        setLayoutConflict(false)
        setLayoutVersions(null)
        done.push(`${LAYOUT_NAME.toLowerCase()} version ${result.version_number}`)
      }
      if (done.length > 0) {
        setSavedAt(clockOf(new Date().toISOString()))
        toast.success('Saved', done.join(' · '))
      }
      if (designResult.status === 'rejected') failed(designResult.reason, DESIGN_NAME, setDesignConflict)
      if (layoutResult.status === 'rejected') failed(layoutResult.reason, LAYOUT_NAME, setLayoutConflict)
      refreshFooter()
    } catch (error) {
      toast.error('Could not save the receipt', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  function failed(error: unknown, name: string, markConflict: (conflict: boolean) => void) {
    if (error instanceof ApiError && error.status === 409) {
      markConflict(true)
      toast.error(`The ${name.toLowerCase()} was not saved`, error.message)
    } else if (error instanceof ApiError && error.status === 400) {
      toast.error(`The ${name.toLowerCase()} cannot be saved yet`, saveErrorDetail(error.fieldErrors))
    } else {
      toast.error(`Could not save the ${name.toLowerCase()}`, error instanceof Error ? error.message : undefined)
    }
  }

  async function activate() {
    if (!backend.activate) return
    setBusy('activate')
    try {
      await backend.activate()
      setCurrentStatus('ACTIVE')
      toast.success('Template activated', 'Campaigns can now be published with it.')
    } catch (error) {
      const items = Object.values(error instanceof ApiError ? error.fieldErrors : {})
      toast.error(items.length ? 'Not ready to activate' : 'Could not activate', items.length ? items.join(' ') : error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function fetchDesignVersions() {
    if (designVersions !== null) return
    setDesignVersionsFailed(false)
    try {
      setDesignVersions(await backend.listDesignVersions())
    } catch {
      setDesignVersionsFailed(true)
    }
  }

  async function fetchLayoutVersions() {
    if (layoutVersions !== null) return
    setLayoutVersionsFailed(false)
    try {
      setLayoutVersions(await backend.listReceiptLayoutVersions())
    } catch {
      setLayoutVersionsFailed(true)
    }
  }

  /** Replacing one part discards only that part's unsaved work, so only that part's changes are asked about. */
  function loadDesignVersion(number: number) {
    if (designDirty) guard.requestLeave(() => void doLoadDesign(number))
    else void doLoadDesign(number)
  }

  function loadLayoutVersion(number: number) {
    if (layoutDirty) guard.requestLeave(() => void doLoadLayout(number))
    else void doLoadLayout(number)
  }

  async function doLoadDesign(number: number) {
    setBusy('load')
    try {
      const older = await backend.loadDesignVersion(number)
      editor.current?.load(older)
      setHeader({ subject: older.subject_line, preheader: older.preheader })
      const isLatest = number === older.latest_version
      setDesignSaved({ version: older.latest_version, shown: number })
      setDesignRestored(!isLatest)
      setSavedAt(clockOf(older.saved_at))
      if (isLatest) {
        editor.current?.markSaved()
        setDesignConflict(false)
      }
    } catch (error) {
      toast.error('Could not load that version', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function doLoadLayout(number: number) {
    setBusy('load')
    try {
      const older = await backend.loadReceiptLayoutVersion(number)
      const isLatest = number === older.latest_version
      setLayout(configOf(older))
      // an older version on screen is unsaved work: the latest stays what it is compared against
      setLayoutSaved((current) => ({ config: isLatest ? configOf(older) : current.config, version: older.latest_version, shown: number }))
      setLayoutRestored(!isLatest)
      setSavedAt(clockOf(older.saved_at))
      if (isLatest) setLayoutConflict(false)
    } catch (error) {
      toast.error('Could not load that version', error instanceof Error ? error.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  async function loadLatest(list: () => Promise<DesignVersion[]>, load: (number: number) => void) {
    try {
      const newest = Math.max(...(await list()).map((item) => item.version_number))
      if (Number.isFinite(newest)) load(newest)
    } catch (error) {
      toast.error('Could not load the latest version', error instanceof Error ? error.message : undefined)
    }
  }

  const pillBar = (
    <>
      <HistoryMenu
        label="Design History"
        heading={titleCase(`${DESIGN_NAME} versions`)}
        versions={designVersions}
        failed={designVersionsFailed}
        shown={designSaved.shown}
        latest={designSaved.version}
        busy={busy !== null}
        controller={pills}
        onOpen={() => void fetchDesignVersions()}
        onLoad={(number) => {
          pills.close({ restoreFocus: false })
          loadDesignVersion(number)
        }}
      />
      <HistoryMenu
        pillKey="receiptHistory"
        label="Layout History"
        heading={titleCase(`${LAYOUT_NAME} versions`)}
        versions={layoutVersions}
        failed={layoutVersionsFailed}
        shown={layoutSaved.shown}
        latest={layoutSaved.version}
        busy={busy !== null}
        controller={pills}
        onOpen={() => void fetchLayoutVersions()}
        onLoad={(number) => {
          pills.close({ restoreFocus: false })
          loadLayoutVersion(number)
        }}
      />
    </>
  )

  const activateReason =
    dirty ? 'Save your changes first.'
    : designSaved.version === 0 || layoutSaved.version === 0 ? 'Save the receipt once first.'
    : undefined

  const note =
    checks === null || checks.failing === 0 ? 'All checks pass.'
    : `${checks.failing} of ${checks.total} checks to fix · see Preview & Test.`

  const footer = (
    <FooterBar
      note={note}
      save={readOnly ? undefined : { onClick: () => void save(), busy: busy === 'save' }}
      primary={
        backend.activate && currentStatus === 'DRAFT' && !readOnly ?
          { label: 'Activate', onClick: () => void activate(), busy: busy === 'activate', disabled: Boolean(activateReason) || busy !== null, disabledReason: activateReason }
        : undefined
      }
    />
  )

  const preset = layout.layout_preset === 'CUSTOM_HTML' ? 'STANDARD' : layout.layout_preset

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
            {designConflict && (
              <ConflictStrip note={conflictNote(DESIGN_NAME)} busy={busy !== null} onLoadLatest={() => void loadLatest(backend.listDesignVersions, loadDesignVersion)} />
            )}
            {layoutConflict && (
              <ConflictStrip note={conflictNote(LAYOUT_NAME)} busy={busy !== null} onLoadLatest={() => void loadLatest(backend.listReceiptLayoutVersions, loadLayoutVersion)} />
            )}
            {designSaved.shown > 0 && designSaved.shown !== designSaved.version && (
              <VersionStrip version={designSaved.shown} note={olderNote(DESIGN_NAME, designSaved.shown)} busy={busy !== null} onBackToLatest={() => loadDesignVersion(designSaved.version)} />
            )}
            {layoutSaved.shown > 0 && layoutSaved.shown !== layoutSaved.version && (
              <VersionStrip version={layoutSaved.shown} note={olderNote(LAYOUT_NAME, layoutSaved.shown)} busy={busy !== null} onBackToLatest={() => loadLayoutVersion(layoutSaved.version)} />
            )}
          </>
        }
        footer={footer}
        panes={[
          {
            id: 'outer',
            content: (
              <OuterDesignPane
                ref={editor}
                initialState={design.editor_state}
                initialMjml={design.mjml_source ?? RECEIPT_STARTER_MJML}
                tags={tags}
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
                onOpenReceiptLayout={() => void changeTab('layout')}
                receiptPreset={preset}
                onReceiptPresetChange={readOnly ? undefined : applyPreset}
                sampleCode={backend.sampleCode}
              />
            ),
          },
          { id: 'layout', content: <ReceiptLayoutPane layout={layout} onChange={setLayout} readOnly={readOnly} /> },
          {
            id: 'preview',
            content: <PreviewTestPane sections={layout.sections} hasFooterBlock={hasFooterBlock} tags={tags} onChecksChange={setChecks} renderCombinedHtml={renderCombinedHtml} />,
          },
        ]}
      />
    </>
  )
}

function latestOf(...stamps: (string | null)[]): string | null {
  return stamps.filter((stamp): stamp is string => Boolean(stamp)).sort().at(-1) ?? null
}

/** "Saved 06:38 UTC" — the zone is always spelled out, because the reader's is not the workspace's. */
function clockOf(iso: string | null | undefined): string | null {
  const clock = formatUtcClock(iso)
  return clock === null ? null : `Saved ${clock}`
}
