/**
 * GrapesJS + MJML email editor. Deliberately knows nothing about the CEP API: data comes in through props and goes
 * out through the imperative handle, so the same component runs in the page, the dev playground and tests.
 *
 *   load    editor_state (GrapesJS project JSON) when a version exists, otherwise the MJML (starter or imported)
 *   save    getDesign() -> { editor_state, mjml_source }. The server renders the HTML that is stored and sent.
 *   preview compileHtml() -> HTML from mjml-browser, only ever shown inside a sandboxed iframe.
 */
import grapesjs, { type Block, type Component, type Editor, type Plugin, type ProjectData } from 'grapesjs'
import grapesjsMjmlModule from 'grapesjs-mjml'
import { Braces, Image as ImageIcon, Layers as LayersIcon, LayoutGrid } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'

import 'grapesjs/dist/css/grapes.min.css'
import './designer.css'

import type { PersonalizationTag } from '@/lib/types'
import { EDITOR_BREAKPOINT, useMinWidth } from '@/lib/useMediaQuery'
import { useSingleDropdown, type SingleDropdown } from '@/lib/useSingleDropdown'

import { BlockPalette } from './BlockPalette'
import { canvasSkin, injectCanvasSkin, paintPhoneWidth } from './canvasSkin'
import { lockEditor } from './readOnly'
import { Breadcrumb, type Crumb } from './canvas/Breadcrumb'
import { CanvasToolbar } from './canvas/CanvasToolbar'
import { DEVICES, fitZoom, frameWidthFor, nextZoom, panForZoom, wheelStepDue, wheelZoomDirection, type ZoomMode } from './zoom/zoom'
import { CodeDialog } from './canvas/CodeDialog'
import { applyCode, compileWith } from './canvas/applyCode'
import { checkMjml } from './canvas/codeChecks'
import { APPLIED_TOAST } from './canvas/codeCopy'
import { downloadText, downloadedToast, fileNameFor, kilobytes } from './canvas/exportFile'
import { copiedToast, copyFailedToast } from './tags/pickerNotes'
import { CLEAN, applyDirty, type DirtyEvent } from './dirtyState'
import { LeftRail, type LeftRailHandle } from './LeftRail'
import { AssetsPanel } from './assets/AssetsPanel'
import { ImagePicker } from './assets/ImagePicker'
import { absoluteUrl, assetAction, assetMessage } from './assets/assetAction'
import { InspectorPanel } from './inspector/InspectorPanel'
import type { ReceiptSlotPreset } from './inspector/receiptSettings'
import { LayersPanel } from './layers/LayersPanel'
import { pruneHidden, sameHidden, toggleHidden } from './layers/hidden'
import { layerNameFor } from './layers/layerNames'
import {
  buildNodes, highlightLayer, layerIds, layerRoot, moveLayer, paintHidden, removeLayer, renameLayer, revealSelected, selectLayer, subscribeLayers, toggleOpen,
} from './layers/layersAdapter'
import type { LayerNode } from './layers/types'
import { dropLevel } from './blocks/dropLevel'
import { insertTarget, type InsertNode } from './blocks/insertTarget'
import { keepChosenValues } from './blocks/keepChosenValues'
import { RECEIPT_BODY_TYPES, registerReceiptBlockTypes } from './blocks/receiptBlocks'
import { registerReceiptSlotType } from './blocks/receiptSlot'
import { needsImage } from './blocks/registry'
import { applyFooterRules, blockContent, blocksFor, isHiddenOnPhones, registerBlocks, setBlockImage, syncHideMobileStyle } from './blocks/register'
import { SRC_KEY, blockType, fieldsFor, isGrouping, writeSetting } from './inspector/settings'
import { expandSelfClosing, repairProject } from './mjml'
import { asToken } from './tags'
import { PICKER_LABEL, TagPickerPopover } from './tags/TagPickerPopover'
import { TagsPanel, type TagsPanelHandle } from './tags/TagsPanel'
import { captureCaret, insertAtCaret, type CaretTarget } from './tags/insertAtCaret'

// grapesjs-mjml ships as a UMD bundle: depending on the bundler the default import is the plugin or a { default } wrapper.
type MjmlPlugin = Plugin<{ resetDevices?: boolean; useCustomTheme?: boolean }>
const grapesjsMjml: MjmlPlugin = (grapesjsMjmlModule as unknown as { default?: MjmlPlugin }).default ?? (grapesjsMjmlModule as unknown as MjmlPlugin)

/** The mj-image a picture block is built around: the block itself for an Image, the one inside a card. */
function imageIn(component: Component): Component {
  return component.findType('mj-image')[0] ?? component
}

export interface DesignerAsset {
  url: string
  name: string
  width?: number | null
  height?: number | null
}

export interface DesignSnapshot {
  editor_state: ProjectData
  mjml_source: string
}

export interface EmailDesignerHandle {
  getDesign: () => DesignSnapshot
  /** the current MJML only: cheap enough to poll for link extraction */
  getMjml: () => string
  compileHtml: () => { html: string; errors: string[] }
  load: (design: { editor_state?: ProjectData | null; mjml_source?: string | null }) => void
  markSaved: () => void
  /** the Tags tab in the left rail, with its search ready to type into */
  openTagsPanel: () => void
  /** drop a palette block in without a pointer; returns the label placed, or null */
  insertBlock: (blockId: string) => string | null
  /** end any in-progress inline text edit so the last typed characters reach the model */
  commitEdit: () => Promise<void>
  /** select the block an issue or link row names and open the setting it is about; false when it is not there */
  revealSetting: (target: { tag: string; nth: number; setting: string }) => boolean
}

/** The custom block manager's payload (grapesjs BlocksCustomData), which drives a drag we start ourselves. */
interface BlocksResultProps {
  dragStart: (block: Block, event: Event) => void
  drag: (event: Event) => void
  dragStop: (cancel?: boolean) => void
}

/** ComponentTextView is not exported by grapesjs; these are the two members we rely on. */
type EditableTextView = { rteEnabled?: boolean; disableEditing?: () => Promise<void> }

interface EmailDesignerProps {
  initialState?: ProjectData | null
  initialMjml: string
  tags: PersonalizationTag[]
  channel?: string
  assets: DesignerAsset[]
  /** uploads one image and resolves to where it is hosted */
  onUploadAsset: (file: File) => Promise<DesignerAsset>
  onDirtyChange: (dirty: boolean) => void
  /**
   * The model moved. Raised for every edit, not only the first one after a save, so a reader of the MJML —
   * the review pills — stays in step with the canvas. Coalesced to one call a frame.
   */
  onCanvasChange?: () => void
  onError: (message: string, detail?: string) => void
  /** a rule the editor enforced, in the reader's words */
  onNotice?: (message: string) => void
  /** where a dragged block ended up; placed: false means the canvas refused the drop */
  onBlockDrop?: (event: { blockId: string; placed: boolean }) => void
  readOnly?: boolean
  /** tag keys chosen lately, newest first, shared with the rest of the workspace */
  recentTags?: string[]
  onTagUsed?: (key: string) => void
  /** the toolbar's Preview: the workspace owns the Preview tab */
  onPreview?: () => void
  /** what a downloaded .html file is called */
  exportName?: string
  /** something went right and is worth a toast: a download, a copied tag */
  onSuccess?: (title: string, detail?: string) => void
  /** E-Receipt: the receipt slot's panel opens Receipt layout and shows which layout fills the slot */
  onOpenReceiptLayout?: () => void
  receiptPreset?: ReceiptSlotPreset
  onReceiptPresetChange?: (preset: ReceiptSlotPreset) => void
}

/** GrapesJS's ids for the devices the toolbar offers */
/** how long a panel note stays before it clears itself */
const MESSAGE_MS = 6000

const DEVICE_IDS: Record<string, string> = { Desktop: 'desktop', Tablet: 'tablet', 'Mobile portrait': 'mobilePortrait' }

/** The one device width at which a block hidden on phones is drawn the way a phone would draw it. */
const PHONE_DEVICE = 'Mobile portrait'

/** A stored state is only usable when it is a GrapesJS project (has pages). Imported or migrated templates carry
 *  other shapes or nothing at all: those open from their MJML instead of as a blank canvas. */
function isProject(state: ProjectData | null | undefined): state is ProjectData {
  return Boolean(state) && Array.isArray((state as { pages?: unknown }).pages) && (state as { pages: unknown[] }).pages.length > 0
}

interface InspectorState {
  kind: string | null
  name: string | null
  component: Component | null
  /** captured with the selection, so the panel never has to read a ref while rendering */
  editor: Editor | null
  wrapper: Component | null
  canSelectParent: boolean
  hasFields: boolean
  /** bumped on every model change, so the fields re-read their values */
  version: number
}

const NO_SELECTION: InspectorState = {
  kind: null, name: null, component: null, editor: null, wrapper: null, canSelectParent: false, hasFields: false, version: 0,
}

/** What the toolbar shows. View state only: none of it reaches the model, the MJML, the project or the dirty flag. */
interface ViewState {
  zoomMode: ZoomMode
  zoom: number
  device: string
  outlines: boolean
  canUndo: boolean
  canRedo: boolean
}

const VIEW_DEFAULTS: ViewState = { zoomMode: 'fit', zoom: 100, device: 'Desktop', outlines: true, canUndo: false, canRedo: false }
const EMAIL_BODY_NAME = 'Email body'
const OUTLINES_COMMAND = 'sw-visibility'

/** The frame's width as the device defines it: the frame element itself lags a device change by a frame. */
function deviceFrameWidth(editor: Editor): number {
  const device = editor.Devices.getDevices().find((item) => item.getName() === editor.getDevice())
  const width = Number.parseInt(String(device?.get('width') ?? ''), 10)
  return Number.isFinite(width) && width > 0 ? width : editor.Canvas.getFrameEl().offsetWidth
}

/** Selection and renames arrive as layer:component; a changed setting as update; a reverted one as undo/redo. */
const INSPECTOR_EVENTS = ['layer:component', 'layer:root', 'update', 'undo', 'redo'] as const

/** The nth block of a tag, counted the way the review counts them: document order, under the body. */
function nthOfTag(root: Component, tag: string, nth: number): Component | undefined {
  let seen = 0
  let found: Component | undefined
  const walk = (node: Component) => {
    for (const child of node.components().models ?? []) {
      if (found) return
      if (String(child.get('type') ?? child.get('tagName')) === tag && seen++ === nth) {
        found = child
        return
      }
      walk(child)
    }
  }
  walk(root)
  return found
}

/** Newest first, no duplicates, eight at most: what the colour picker offers as recently used. */
function rememberColor(recent: string[], hex: string): string[] {
  return [hex, ...recent.filter((item) => item !== hex)].slice(0, 8)
}

/**
 * The text being edited on the canvas, and where its caret is, or null when no text block is in edit mode.
 * The editable is the text view's own element once GrapesJS has made it contentEditable.
 */
function caretOnCanvas(editor: Editor): CaretTarget | null {
  const view = editor.getSelected()?.view as (EditableTextView & { el?: HTMLElement }) | undefined
  const doc = editor.Canvas.getDocument()
  const win = editor.Canvas.getWindow()
  if (!view?.rteEnabled || !doc || !win) return null
  const editable = view.el?.isContentEditable ? view.el : doc.querySelector<HTMLElement>('[contenteditable="true"]')
  const range = captureCaret(doc)
  return editable && range ? { window: win, editable, range } : null
}

export const EmailDesigner = forwardRef<EmailDesignerHandle, EmailDesignerProps>(function EmailDesigner(props, ref) {
  const container = useRef<HTMLDivElement>(null)
  const designer = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  // true while a stored design is being loaded, so the footer rules leave it exactly as it was saved
  const loading = useRef(false)
  const sweepFooters = useRef<() => void>(() => {})
  const skinCanvas = useRef<() => void>(() => {})
  const blockPayload = useRef<BlocksResultProps | null>(null)
  const dragMove = useRef<((event: PointerEvent) => void) | null>(null)
  // set when the reader pressed Escape: a cancelled drag is not a refused one, so it says nothing
  const dragCancelled = useRef(false)
  const [paletteMessage, setPaletteMessage] = useState<string | null>(null)
  const [layerNodes, setLayerNodes] = useState<LayerNode[]>([])
  const [inspector, setInspector] = useState<InspectorState>(NO_SELECTION)
  const [recentColors, setRecentColors] = useState<string[]>([])
  const [focusSetting, setFocusSetting] = useState<string | null>(null)
  const refreshInspector = useRef<() => void>(() => {})
  const [view, setView] = useState<ViewState>(VIEW_DEFAULTS)
  // both side panels folded away for the canvas; lifting it puts each back exactly as it was
  const [fullscreen, setFullscreen] = useState(false)
  // the generated HTML on show in the code dialog, or null while it is closed
  // the Email code dialog: the MJML the design saves as, and the HTML it compiles to, read when it opens
  const [code, setCode] = useState<{ mjml: string; html: string } | null>(null)
  const frameObserver = useRef<ResizeObserver | null>(null)
  // below this the panel and the canvas cannot both have room, so the rail shows only its strip
  const railFits = useMinWidth(EDITOR_BREAKPOINT.openRail)
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  // read by the editor's one-time listeners, which cannot see React state
  const zoomMode = useRef<ZoomMode>('fit')

  /** Zooms the canvas, keeps the frame centred or pinned to the left edge, and redraws the outlines one pixel wide. */
  const applyZoom = useCallback((zoom: number, mode: ZoomMode, frameWidth?: number) => {
    const editor = editorRef.current
    if (!editor) return
    zoomMode.current = mode
    editor.Canvas.setZoom(zoom)
    editor.Canvas.setCoords(panForZoom(frameWidth ?? deviceFrameWidth(editor), editor.Canvas.getElement().clientWidth, zoom), 0)
    editor.refresh()
    for (const frame of editor.Canvas.getFrames()) injectCanvasSkin(frame.view?.getDoc(), canvasSkin(document.documentElement, editor.Canvas.getZoomDecimal()))
    setView((was) => ({ ...was, zoom, zoomMode: mode }))
  }, [])

  /** Recomputes the fit, when fit is what the reader wants; a manual zoom is left alone. */
  const refit = useCallback(
    (frameWidth?: number) => {
      const editor = editorRef.current
      if (!editor || zoomMode.current !== 'fit') return
      const width = frameWidth ?? deviceFrameWidth(editor)
      applyZoom(fitZoom(editor.Canvas.getElement().clientWidth, width), 'fit', width)
    },
    [applyZoom],
  )

  /** The HTML the server would render from this design: the same compile the Preview tab uses. */
  const compileHtml = useCallback((): { html: string; errors: string[] } => {
    const editor = editorRef.current
    if (!editor) return { html: '', errors: ['The editor is not ready'] }
    const result = editor.runCommand('mjml-code-to-html') as { html?: string; errors?: { formattedMessage?: string; message?: string }[] } | undefined
    return { html: result?.html ?? '', errors: (result?.errors ?? []).map((error) => error.formattedMessage ?? error.message ?? 'MJML error') }
  }, [])

  // Escape leaves fullscreen, and leaving it re-places the overlays for the wider canvas
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullscreen])
  const [uploaded, setUploaded] = useState<DesignerAsset[]>([])
  const [uploading, setUploading] = useState<string[]>([])
  const rail = useRef<LeftRailHandle>(null)
  const uploadAssets = useRef<(files: File[]) => void>(() => {})
  // the block whose picture is being chosen. `added` is the block a drop just made, which is taken away
  // again if no picture is chosen for it: a block showing a stand-in is what this is all here to avoid.
  const [picking, setPicking] = useState<{ image: Component; added: Component | null } | null>(null)
  // the tag picker hung off the rich-text toolbar: the button GrapesJS drew, and the caret as it was when pressed
  const canvasPicker = useSingleDropdown<'canvas'>()
  // the toolbar button is wired once, when the editor is built, and reaches the current dropdown through this
  const canvasPickerRef = useRef<SingleDropdown<'canvas'> | null>(null)
  useEffect(() => {
    canvasPickerRef.current = canvasPicker
  })
  const [canvasTagButton, setCanvasTagButton] = useState<HTMLElement | null>(null)
  const canvasCaret = useRef<CaretTarget | null>(null)
  // the Tags tab: the caret as it was when the reader first pressed inside the panel
  const tagsPanel = useRef<TagsPanelHandle>(null)
  const panelCaret = useRef<CaretTarget | null>(null)
  // set while the dialog's own upload is in flight, so the file that arrives goes straight into that block
  const applyNextUpload = useRef(false)
  // set when a picture block was dragged out of the palette, so the drop it lands in asks for a picture
  const askAfterDrop = useRef(false)
  const insertBlockRef = useRef<(blockId: string, picture?: string | null) => string | null>(() => null)
  // hidden is a canvas-only view state: it never reaches the component model, the MJML or the saved project
  const hidden = useRef<ReadonlySet<string>>(new Set<string>())
  const refreshLayers = useRef<() => void>(() => {})
  const pushDirty = useRef<(event: DirtyEvent) => void>(() => {})
  const messageTimer = useRef<number | undefined>(undefined)
  // the editor is created once, so its listeners reach the latest say() through this
  const sayRef = useRef<(message: string | null) => void>(() => {})
  // Callbacks change identity on every render of the page; the editor is created once and reads the latest through this.
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })

  const downloadHtml = useCallback(() => {
    const { html } = compileHtml()
    const fileName = fileNameFor(latest.current.exportName ?? 'email', 'html')
    downloadText(html, fileName)
    latest.current.onSuccess?.(...downloadedToast(fileName, html))
  }, [compileHtml])

  const downloadMjml = useCallback((mjml: string) => {
    const fileName = fileNameFor(latest.current.exportName ?? 'email', 'mjml')
    downloadText(mjml, fileName, 'text/plain')
    latest.current.onSuccess?.('MJML downloaded', `${fileName} · ${kilobytes(mjml)} KB`)
  }, [])

  const openCode = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    setCode({ mjml: editor.getHtml(), html: compileHtml().html })
  }, [compileHtml])

  /** Hand-edited MJML in place of the design: one undo step, and unsaved until saved (see canvas/applyCode.ts). */
  const applyMjml = useCallback(
    async (text: string) => {
      const editor = editorRef.current
      if (!editor || latest.current.readOnly) return { changes: [] }
      const { applied, changes } = await applyCode(editor, text)
      refreshLayers.current()
      setCode({ mjml: applied, html: compileHtml().html })
      latest.current.onSuccess?.(APPLIED_TOAST)
      return { changes }
    },
    [compileHtml],
  )

  const library = useMemo(() => [...props.assets, ...uploaded], [props.assets, uploaded])

  useEffect(() => {
    if (!container.current) return
    const { initialState, initialMjml, tags, channel = 'EMAIL', readOnly } = latest.current

    const editor = grapesjs.init({
      container: container.current,
      height: '100%',
      width: 'auto',
      fromElement: false,
      blockManager: { custom: true }, // the palette is ours (BlockPalette), not GrapesJS's own panel
      layerManager: { custom: true }, // the layers tree is ours (LayersPanel), not GrapesJS's own panel
      storageManager: false, // persistence is the page's job (versioned saves through the API)
      noticeOnUnload: false, // the page owns the unsaved-changes prompt
      // Options go to the plugin directly (pluginsOpts is keyed by plugin *name*, which a function plugin does not have).
      // useCustomTheme: false stops it injecting its own dark palette, so the skin comes from designer.css (Tailwind tokens).
      plugins: [(instance) => grapesjsMjml(instance, { resetDevices: true, useCustomTheme: false })],
      assetManager: {
        custom: true, // the image library is ours (AssetsPanel), not GrapesJS's own modal
        embedAsBase64: false, // inline images bloat the message past Gmail's 102 KB clip limit
        // dropping a file straight onto the canvas goes through the same upload as the panel's button
        uploadFile: (event) => {
          const source = (event as DragEvent).dataTransfer?.files ?? (event.target as HTMLInputElement | null)?.files
          uploadAssets.current(Array.from(source ?? []))
        },
      },
    })
    editorRef.current = editor
    let dirtyState = CLEAN
    pushDirty.current = (event: DirtyEvent) => {
      const next = applyDirty(dirtyState, event)
      dirtyState = next.state
      if (next.notify) latest.current.onDirtyChange(next.state.edited)
    }

    // Before anything is loaded: it rebuilds the component classes, so only components made afterwards use them.
    keepChosenValues(editor)
    registerBlocks(editor, { channel })
    registerReceiptSlotType(editor, { channel })
    registerReceiptBlockTypes(editor, { channel })
    // A Desktop frame as wide as the canvas would make the email reflow narrower on a small window; at a fixed
    // width the layout is always the 600px one, and fit zoom scales it to the room there is.
    for (const device of DEVICES) editor.Devices.get(DEVICE_IDS[device.id])?.set('width', `${frameWidthFor(device)}px`)
    sweepFooters.current = applyFooterRules(editor, {
      channel,
      readOnly,
      isLoading: () => loading.current,
      onNotice: (message) => {
        sayRef.current(message)
        latest.current.onNotice?.(message)
      },
    })
    // The frame is its own document: designer.css cannot reach it, so the editing chrome is injected.
    const skin = () => {
      for (const frame of editor.Canvas.getFrames()) {
        injectCanvasSkin(frame.view?.getDoc(), skinFor())
        paintPhoneWidth(frame.view?.getDoc(), editor.getDevice() === PHONE_DEVICE)
      }
    }
    skinCanvas.current = skin
    const skinFor = () => canvasSkin(document.documentElement, editor.Canvas.getZoomDecimal())
    let lastWheelStep = -Infinity
    const onWheel = (event: WheelEvent) => {
      const direction = wheelZoomDirection(event)
      if (direction === null) return
      event.preventDefault() // the page must not zoom, whether or not this event is the one that steps
      const now = performance.now()
      if (!wheelStepDue(lastWheelStep, now)) return
      lastWheelStep = now
      applyZoom(nextZoom(editor.Canvas.getZoom(), direction), 'manual')
    }
    editor.on('canvas:frame:load', ({ window: frame }) => {
      injectCanvasSkin(frame.document, skinFor())
      paintPhoneWidth(frame.document, editor.getDevice() === PHONE_DEVICE)
      frame.addEventListener('wheel', onWheel, { passive: false })
      // the sheet eases between devices: the fit and the centring follow its width as it goes
      const sheet = frame.frameElement as HTMLIFrameElement | null
      if (!sheet) return
      frameObserver.current?.disconnect()
      frameObserver.current = new ResizeObserver(() => refit(sheet.offsetWidth))
      frameObserver.current.observe(sheet)
    })
    editor.on('canvas:zoom', () => {
      for (const frame of editor.Canvas.getFrames()) {
        injectCanvasSkin(frame.view?.getDoc(), skinFor())
        paintPhoneWidth(frame.view?.getDoc(), editor.getDevice() === PHONE_DEVICE)
      }
    })

    // A GrapesJS re-render drops the hidden attribute, so it is repainted every time the tree is rebuilt.
    refreshLayers.current = () => {
      revealSelected(editor)
      const live = pruneHidden(hidden.current, layerIds(editor))
      if (!sameHidden(live, hidden.current)) hidden.current = live
      paintHidden(editor, hidden.current)
      setLayerNodes(buildNodes(editor, hidden.current))
    }
    const unsubscribeLayers = subscribeLayers(editor, () => refreshLayers.current())

    // The inspector reads the selection (layer:component) and the values themselves (update), one frame apart.
    refreshInspector.current = () => {
      // Every preview of a drag raises update. Re-reading then would re-render the whole panel on each frame,
      // and the field already holds the value being dragged, so the panel waits for the edit to settle.
      if (isGrouping()) return
      const selected = editor.getSelected()
      const root = layerRoot(editor)
      if (!selected || !root) {
        setInspector(NO_SELECTION)
        setCrumbs([])
        return
      }
      const kind = blockType(selected)
      const parent = selected.parent()
      const chain: Crumb[] = []
      for (let node: Component | undefined = selected; node; node = node.parent()) {
        if (node === root) {
          chain.unshift({ id: String(root.getId()), name: EMAIL_BODY_NAME })
          break
        }
        chain.unshift({
          id: String(node.getId()),
          name: layerNameFor(blockType(node), node.get('custom-name'), node.getAttributes()),
          hiddenOnPhones: isHiddenOnPhones(node),
        })
      }
      setCrumbs(chain[0]?.name === EMAIL_BODY_NAME ? chain : [])
      setInspector((was) => ({
        kind,
        name: layerNameFor(kind, selected.get('custom-name'), selected.getAttributes()),
        component: selected,
        editor,
        wrapper: editor.getWrapper() ?? null,
        canSelectParent: Boolean(parent) && parent !== root,
        hasFields: fieldsFor(selected).length > 0,
        version: was.version + 1,
      }))
    }
    let inspectorFrame = 0
    const scheduleInspector = () => {
      if (inspectorFrame !== 0) return
      inspectorFrame = requestAnimationFrame(() => {
        inspectorFrame = 0
        refreshInspector.current()
      })
    }
    for (const event of INSPECTOR_EVENTS) editor.on(event, scheduleInspector)

    // An edit raises no undo event of its own, so the history buttons re-read on every model change too.
    const syncHistory = () => setView((was) => ({ ...was, canUndo: editor.UndoManager.hasUndo(), canRedo: editor.UndoManager.hasRedo() }))
    for (const event of ['update', 'undo', 'redo']) editor.on(event, syncHistory)

    // The head's hide-on-phones rule follows the blocks that use it, including across an undo or a redo.
    const syncPhoneRule = () => {
      // view-only never changes the head: the sync would also restart the undo stack the lock stopped
      if (!loading.current && !latest.current.readOnly) syncHideMobileStyle(editor)
    }
    for (const event of ['update', 'undo', 'redo']) editor.on(event, syncPhoneRule)

    editor.on('device:select', () => {
      setView((was) => ({ ...was, device: editor.getDevice() }))
      requestAnimationFrame(() => refit()) // the frame takes its new width first
    })
    editor.on(`command:run:${OUTLINES_COMMAND}`, () => setView((was) => ({ ...was, outlines: true })))
    editor.on(`command:stop:${OUTLINES_COMMAND}`, () => setView((was) => ({ ...was, outlines: false })))
    editor.Canvas.getElement().addEventListener('wheel', onWheel, { passive: false })
    let refitFrame = 0
    // the canvas changes width whenever a panel does: the overlays are re-placed, and the fit follows it
    const resized = new ResizeObserver(() => {
      if (refitFrame !== 0) return
      refitFrame = requestAnimationFrame(() => {
        refitFrame = 0
        editor.refresh()
        refit()
      })
    })
    resized.observe(editor.Canvas.getElement())

    // GrapesJS still opens its own (now empty) modal for the asset picker, so it is closed and ours shown instead.
    editor.on('asset:custom', (props: { open: boolean }) => {
      if (!props.open) return
      editor.AssetManager.close()
      const selected = editor.getSelected()
      if (selected && !latest.current.readOnly) setPicking({ image: imageIn(selected), added: null })
    })

    // A picture block dragged out of the palette carries no picture: the drop is where the reader is asked for one.
    editor.on('component:add', (component: Component) => {
      if (!askAfterDrop.current || loading.current) return
      askAfterDrop.current = false
      setPicking({ image: imageIn(component), added: component })
    })

    const cancelledRef = dragCancelled
    editor.on('block:custom', (props: BlocksResultProps) => {
      blockPayload.current = props
    })

    // A refused drop leaves the canvas untouched and says nothing of its own, so the palette explains it.
    editor.on('block:drag:stop', (component: Component | undefined, block: Block) => {
      const blockId = String(block.getId())
      const placed = Boolean(component)
      latest.current.onBlockDrop?.({ blockId, placed })

      const dropped = blocksFor(channel).find((item) => item.id === blockId)
      if (placed) sayRef.current(dropped ? `${dropped.label} added.` : null)
      else if (cancelledRef.current) sayRef.current(null)
      else sayRef.current(dropped && dropLevel(dropped) === 'column' ? 'Drop this inside a column.' : "Can't drop here.")
    })

    // Personalization: a button in the rich-text toolbar opens the tag picker over the caret. The caret is noted
    // as the button is pressed, since the picker takes focus and a tag is chosen some time later.
    if (tags.length > 0) {
      editor.RichTextEditor.add('cep-tags', {
        icon: '',
        attributes: { title: PICKER_LABEL, 'aria-label': PICKER_LABEL, role: 'button', tabindex: '0', 'aria-haspopup': 'dialog' },
        result: () => {
          const picker = canvasPickerRef.current
          if (!picker) return
          canvasCaret.current = caretOnCanvas(editor)
          picker.toggle('canvas')
        },
      })
      // The toolbar, and with it the button, is built the first time a text block is edited: that is when the
      // button gets its glyph and is wired as the popover's trigger.
      editor.on('rte:enable', () => {
        const button = (editor.RichTextEditor.get('cep-tags') as { btn?: HTMLElement } | undefined)?.btn
        if (!button) return
        canvasPickerRef.current?.triggerProps('canvas').ref(button)
        setCanvasTagButton((was) => (was === button ? was : button))
      })
    }

    // Self-closing MJML tags are expanded before they reach the editor, and designs saved while they were not are put
    // right on load (see ./mjml.ts): otherwise everything after a divider ends up inside it and is dropped from the email.
    let repaired = 0
    loading.current = true
    try {
      if (isProject(initialState)) {
        const fixed = repairProject(initialState)
        repaired = fixed.moved
        editor.loadProjectData(fixed.project)
      } else editor.setComponents(expandSelfClosing(initialMjml))
    } catch {
      editor.setComponents(expandSelfClosing(initialMjml)) // a project saved by an older editor build: fall back to its MJML
    } finally {
      loading.current = false
    }

    editor.on('load', () => {
      sweepFooters.current()
      if (!readOnly) syncHideMobileStyle(editor)
      skinCanvas.current()
      refreshLayers.current()
      pushDirty.current({ kind: 'set', edited: repaired > 0 }) // a repaired design must be saved again so the stored HTML is rebuilt
      // view-only: every block can still be selected and read, but not changed (see ./readOnly.ts)
      if (readOnly) lockEditor(editor)
      // The guides are shown from the start while the command reports itself off: running it once puts the two in step.
      editor.runCommand(OUTLINES_COMMAND)
      editor.setDevice('Desktop')
      refit()
    })
    // 'update' covers content edits, adds, removes and moves. Undoing some changes — a layer rename, for one —
    // raises only 'undo', so those are counted too: either way the design no longer matches what was saved.
    let changeFrame = 0
    const edited = () => {
      pushDirty.current({ kind: 'edit', loading: loading.current })
      if (loading.current || changeFrame !== 0) return
      changeFrame = requestAnimationFrame(() => {
        changeFrame = 0
        latest.current.onCanvasChange?.()
      })
    }
    editor.on('update', edited)
    editor.on('undo', edited)
    editor.on('redo', edited)

    return () => {
      editorRef.current = null
      unsubscribeLayers()
      if (inspectorFrame !== 0) cancelAnimationFrame(inspectorFrame)
      if (changeFrame !== 0) cancelAnimationFrame(changeFrame)
      for (const event of INSPECTOR_EVENTS) editor.off(event, scheduleInspector)
      resized.disconnect()
      frameObserver.current?.disconnect()
      if (refitFrame !== 0) cancelAnimationFrame(refitFrame)
      editor.destroy()
    }
  }, [applyZoom, refit])


  const say = useCallback((message: string | null) => {
    window.clearTimeout(messageTimer.current)
    setPaletteMessage(message)
    if (message !== null) messageTimer.current = window.setTimeout(() => setPaletteMessage(null), MESSAGE_MS)
  }, [])

  useEffect(() => {
    sayRef.current = say
  }, [say])

  // Only the phone width hides a block hidden on phones. Keyed on the settled device, and painted as an
  // attribute rather than a fresh stylesheet, so a canvas re-render cannot leave the two out of step.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    for (const frame of editor.Canvas.getFrames()) paintPhoneWidth(frame.view?.getDoc(), view.device === PHONE_DEVICE)
  }, [view.device])

  useEffect(() => () => window.clearTimeout(messageTimer.current), [])

  /**
   * Puts a palette block in without a pointer. Returns the label placed, or null when nothing was.
   * A picture block given no address asks for one; given an address it is built with it and asks nothing.
   */
  const insertBlock = useCallback(
    (blockId: string, picture: string | null = null): string | null => {
      const editor = editorRef.current
      const { readOnly, channel = 'EMAIL' } = latest.current
      if (!editor || readOnly) return null

      const block = blocksFor(channel).find((item) => item.id === blockId)
      const body = editor.getWrapper()?.findType('mj-body')[0]
      if (!block || !body) return null

      const tree = toTree(body)
      const target = insertTarget(tree, pathTo(tree, editor.getSelected()), dropLevel(block))
      if (!target) return null

      const added = (target.parent as MappedNode).component.components().add(expandSelfClosing(blockContent(block, picture)), { at: target.index })
      const placed = Array.isArray(added) ? added[0] : added
      if (placed) {
        editor.select(placed)
        editor.Canvas.scrollTo(placed, { behavior: 'smooth' })
        // a block built around a picture has none yet: the reader is asked for one rather than shown a stand-in
        if (needsImage(block) && picture === null) setPicking({ image: imageIn(placed), added: placed })
      }
      say(target.fellBack ? `${block.label} added to the last section.` : `${block.label} added.`)
      return block.label
    },
    [say],
  )

  /** Every layer action goes through the normal edit path, so undo works and the design turns dirty. */
  const withEditor = useCallback((run: (editor: Editor) => void, mutating: boolean) => {
    const editor = editorRef.current
    if (!editor || (mutating && latest.current.readOnly)) return
    run(editor)
    refreshLayers.current()
  }, [])

  /** The Assets tab is where images live; clicking one there already applies it to the selected block. */
  const chooseImage = useCallback(() => {
    const selected = editorRef.current?.getSelected()
    if (latest.current.readOnly || !selected) return
    setPicking({ image: imageIn(selected), added: null })
  }, [])

  /** A crumb selects its block on the canvas and in Layers, and brings it into view. */
  const selectCrumb = useCallback(
    (id: string) => {
      withEditor((editor) => selectLayer(editor, id), false)
    },
    [withEditor],
  )

  /** Steps up one level, which moves the canvas selection and the Layers tree with it. */
  const selectParent = useCallback(() => {
    withEditor((editor) => {
      const parent = editor.getSelected()?.parent()
      if (!parent) return
      editor.select(parent)
      editor.Canvas.scrollTo(parent, { behavior: 'smooth' })
    }, false)
  }, [withEditor])

  const onLayerToggleVisible = useCallback(
    (id: string) => {
      if (latest.current.readOnly) return
      hidden.current = toggleHidden(hidden.current, id)
      refreshLayers.current()
    },
    [],
  )

  // An upload started inside the dialog finishes long after the handler that began it, so the block being
  // given a picture is read from here rather than captured.
  const pickingRef = useRef<{ image: Component; added: Component | null } | null>(null)
  useEffect(() => {
    pickingRef.current = picking
  }, [picking])

  /** What the dialog does with the image the reader settled on, whether picked from the library or uploaded. */
  const applyPicked = useCallback((asset: DesignerAsset) => {
    const open = pickingRef.current
    if (open) writeSetting(open.image, SRC_KEY, absoluteUrl(asset.url))
    setPicking(null)
  }, [])

  /** A tag chosen from the toolbar goes where the caret was when the toolbar button was pressed. */
  const insertTagOnCanvas = useCallback((key: string) => {
    const caret = canvasCaret.current
    canvasCaret.current = null
    latest.current.onTagUsed?.(key)
    if (caret) insertAtCaret(caret, asToken(key))
  }, [])

  /** The first press in the Tags tab: the canvas caret is noted before anything else can move it. */
  const engageTagsPanel = useCallback(() => {
    const editor = editorRef.current
    panelCaret.current = editor ? caretOnCanvas(editor) : null
  }, [])

  /** A tag from the Tags tab goes where the caret was; true when it did, so the panel knows not to copy. */
  const pickFromTagsPanel = useCallback((key: string): boolean => {
    const editor = editorRef.current
    const caret = panelCaret.current ?? (editor ? caretOnCanvas(editor) : null)
    panelCaret.current = null
    latest.current.onTagUsed?.(key)
    return caret !== null && insertAtCaret(caret, asToken(key))
  }, [])

  /** Closing without a picture: a block the drop had just made goes with it, rather than standing in for one. */
  const cancelPicking = useCallback(() => {
    pickingRef.current?.added?.remove()
    setPicking(null)
  }, [])

  const uploadFiles = useCallback((files: File[]) => {
    if (files.length === 0 || latest.current.readOnly) return
    setUploading((names) => [...names, ...files.map((file) => file.name)])
    for (const file of files) {
      latest.current
        .onUploadAsset(file)
        .then((asset) => {
          setUploaded((list) => [...list, asset])
          sayRef.current(`${asset.name} uploaded.`)
          if (applyNextUpload.current) {
            applyNextUpload.current = false
            applyPicked(asset)
          }
        })
        .catch((error: unknown) => latest.current.onError(error instanceof Error ? error.message : 'Upload failed'))
        .finally(() => setUploading((names) => removeFirst(names, file.name)))
    }
  }, [applyPicked])

  useEffect(() => {
    uploadAssets.current = uploadFiles
  }, [uploadFiles])

  /** An image already on the canvas takes the new picture; otherwise a new Image block is inserted with it. */
  const useAsset = useCallback(
    (asset: DesignerAsset) => {
      const editor = editorRef.current
      if (!editor || latest.current.readOnly) return

      const url = absoluteUrl(asset.url)
      const action = assetAction(editor.getSelected()?.get('type') as string | undefined)
      if (action === 'insert') {
        if (insertBlockRef.current('image', url) === null) return
        say(assetMessage(action))
        return
      }

      const target = editor.getSelected()
      if (!target || !writeSetting(target, SRC_KEY, url)) return
      say(assetMessage(action))
    },
    [say],
  )


  useEffect(() => {
    insertBlockRef.current = insertBlock
  }, [insertBlock])

  // The canvas is an iframe, so a pointerup over it never reaches the tile: the drag is followed on the
  // document and ended there instead.
  const endBlockDrag = useCallback((cancel = false) => {
    dragCancelled.current = cancel
    if (dragMove.current) document.removeEventListener('pointermove', dragMove.current)
    dragMove.current = null
    document.removeEventListener('keydown', dragKey.current)
    blockPayload.current?.dragStop(cancel)
  }, [])

  const dragKey = useRef((event: KeyboardEvent) => {
    if (event.key === 'Escape') endBlockDragEver.current(true)
  })
  const endBlockDragEver = useRef(endBlockDrag)
  useEffect(() => {
    endBlockDragEver.current = endBlockDrag
  }, [endBlockDrag])

  const beginBlockDrag = useCallback(
    (blockId: string, event: ReactPointerEvent, picture: string | null = null) => {
      const editor = editorRef.current
      const payload = blockPayload.current
      const block = editor?.Blocks.get(blockId)
      const source = blocksFor(latest.current.channel ?? 'EMAIL').find((item) => item.id === blockId)
      if (!editor || !payload || !block || !source) return
      // an image carried out of the library rides on the same block, so every drag says what it carries
      setBlockImage(editor, picture)
      askAfterDrop.current = needsImage(source) && picture === null
      say(null)
      dragCancelled.current = false
      payload.dragStart(block, event.nativeEvent)
      const move = (pointer: PointerEvent) => blockPayload.current?.drag(pointer)
      dragMove.current = move
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', () => endBlockDrag(), { once: true })
      document.addEventListener('keydown', dragKey.current)
    },
    [endBlockDrag, say],
  )

  /** Carrying an image out of the library drops an Image block holding that picture, wherever it lands. */
  const beginAssetDrag = useCallback(
    (asset: DesignerAsset, event: ReactPointerEvent) => {
      if (latest.current.readOnly) return
      beginBlockDrag('image', event, absoluteUrl(asset.url))
    },
    [beginBlockDrag],
  )

  useImperativeHandle(ref, () => ({
    getDesign: () => {
      const editor = editorRef.current
      if (!editor) throw new Error('The editor is not ready')
      return { editor_state: editor.getProjectData(), mjml_source: editor.getHtml() }
    },
    getMjml: () => editorRef.current?.getHtml() ?? '',
    compileHtml,
    load: (design) => {
      const editor = editorRef.current
      if (!editor) return
      loading.current = true
      try {
        if (isProject(design.editor_state)) editor.loadProjectData(repairProject(design.editor_state).project)
        else if (design.mjml_source) editor.setComponents(expandSelfClosing(design.mjml_source))
      } finally {
        loading.current = false
      }
      sweepFooters.current()
      // a version loaded in view-only arrives unlocked, like any freshly built component
      if (latest.current.readOnly) lockEditor(editor)
      skinCanvas.current()
      refreshLayers.current()
      editor.UndoManager.clear()
      pushDirty.current({ kind: 'settle' })
      if (!editor.Commands.isActive(OUTLINES_COMMAND)) editor.runCommand(OUTLINES_COMMAND)
      editor.setDevice('Desktop')
      zoomMode.current = 'fit'
      refit()
      setView((was) => ({ ...was, canUndo: false, canRedo: false }))
    },
    markSaved: () => {
      pushDirty.current({ kind: 'settle' })
    },
    openTagsPanel: () => {
      rail.current?.openTab('tags')
      // the panel is hidden until the rail has re-rendered, and a hidden input cannot take focus
      window.setTimeout(() => tagsPanel.current?.focusSearch(), 0)
    },
    // disableEditing() merges the contentEditable DOM back into the component model (syncContent) and resolves
    // once it has; awaiting it is what makes the next getHtml()/compileHtml() include the last keystrokes.
    insertBlock,
    revealSetting: ({ tag, nth, setting }) => {
      const editor = editorRef.current
      const body = editor?.getWrapper()?.findType('mj-body')[0]
      const target = editor && body ? nthOfTag(body, tag, nth) : undefined
      if (!editor || !target) return false
      editor.select(target)
      editor.Canvas.scrollTo(target, { behavior: 'smooth' })
      // cleared first, so clicking the same row twice focuses the field again
      setFocusSetting(null)
      window.setTimeout(() => setFocusSetting(setting), 0)
      return true
    },
    commitEdit: async () => {
      const view = editorRef.current?.getSelected()?.view as EditableTextView | undefined
      if (view?.rteEnabled && typeof view.disableEditing === 'function') await view.disableEditing()
    },
  }))

  return (
    <div ref={designer} className="flex h-full min-h-0 bg-surface">
      <LeftRail
        ref={rail}
        aria-label="Designer panels"
        storageKey="cep.designer.rail"
        autoCollapse={!railFits}
        forceCollapsed={fullscreen}
        onPressWhileForced={(id) => {
          setFullscreen(false)
          window.setTimeout(() => rail.current?.openTab(id), 0)
        }}
        // GrapesJS positions its outlines, toolbar and badge from measured coordinates, so it is remeasured
        // whenever the canvas width changes.
        onLayoutChange={() => {
          editorRef.current?.refresh()
          refit()
        }}
        tabs={[
          {
            id: 'blocks',
            label: 'Blocks',
            icon: LayoutGrid,
            panel: (
              <BlockPalette
                blocks={blocksFor(props.channel ?? 'EMAIL')}
                flat={props.channel === 'E_RECEIPT'}
                disabled={props.readOnly}
                message={paletteMessage}
                onDragStart={beginBlockDrag}
                onInsert={insertBlock}
              />
            ),
          },
          {
            id: 'layers',
            label: 'Layers',
            icon: LayersIcon,
            panel: (
              <LayersPanel
                nodes={layerNodes}
                disabled={props.readOnly}
                onSelect={(id) => withEditor((editor) => selectLayer(editor, id), false)}
                onToggleOpen={(id) => withEditor((editor) => toggleOpen(editor, id), false)}
                onToggleVisible={onLayerToggleVisible}
                onRename={(id, name) => withEditor((editor) => renameLayer(editor, id, name), true)}
                onDelete={(id) => withEditor((editor) => removeLayer(editor, id), true)}
                onMove={(id, direction) => withEditor((editor) => moveLayer(editor, id, direction), true)}
                onHover={(id) => withEditor((editor) => highlightLayer(editor, id), false)}
              />
            ),
          },
          {
            id: 'assets',
            label: 'Assets',
            icon: ImageIcon,
            panel: (
              <AssetsPanel
                assets={library}
                uploading={uploading}
                disabled={props.readOnly}
                message={paletteMessage}
                onUpload={uploadFiles}
                onUse={useAsset}
                onDragStart={beginAssetDrag}
              />
            ),
          },
          {
            id: 'tags',
            label: 'Tags',
            icon: Braces,
            panel: (
              <TagsPanel
                ref={tagsPanel}
                tags={props.tags}
                channel={props.channel ?? 'EMAIL'}
                recent={props.recentTags ?? []}
                disabled={props.readOnly}
                onPick={pickFromTagsPanel}
                onEngage={engageTagsPanel}
                onCopied={(token) => latest.current.onSuccess?.(...copiedToast(token))}
                onCopyFailed={(token, reason) => latest.current.onError(...copyFailedToast(token, reason))}
              />
            ),
          },
        ]}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <CanvasToolbar
          canUndo={view.canUndo}
          canRedo={view.canRedo}
          onUndo={() => editorRef.current?.UndoManager.undo()}
          onRedo={() => editorRef.current?.UndoManager.redo()}
          zoom={view.zoom}
          zoomMode={view.zoomMode}
          onZoomIn={() => applyZoom(nextZoom(view.zoom, 'in'), 'manual')}
          onZoomOut={() => applyZoom(nextZoom(view.zoom, 'out'), 'manual')}
          onZoomSelect={(value) => {
            if (value === 'fit') {
              zoomMode.current = 'fit'
              refit()
            } else applyZoom(value, 'manual')
          }}
          devices={DEVICES}
          device={view.device}
          onDeviceChange={(id) => editorRef.current?.setDevice(id)}
          outlines={view.outlines}
          onOutlinesChange={(next) => {
            const editor = editorRef.current
            if (!editor) return
            if (next) editor.runCommand(OUTLINES_COMMAND)
            else editor.stopCommand(OUTLINES_COMMAND)
          }}
          onPreview={() => props.onPreview?.()}
          fullscreen={fullscreen}
          onFullscreen={() => setFullscreen((was) => !was)}
          onViewCode={openCode}
          onDownload={downloadHtml}
          disabled={props.readOnly}
        />
        <Breadcrumb crumbs={crumbs} onSelect={selectCrumb} />
        <div ref={container} className="cep-designer min-h-0 flex-1" />
      </div>
      {fullscreen ? null : (
      <InspectorPanel
        onDeselect={() => {
          const editor = editorRef.current
          if (!editor) return
          editor.select([])
          refreshInspector.current()
          refreshLayers.current()
        }}
        kind={inspector.kind}
        name={inspector.name}
        component={inspector.component}
        editor={inspector.editor}
        wrapper={inspector.wrapper}
        canSelectParent={inspector.canSelectParent}
        onSelectParent={selectParent}
        disabled={props.readOnly}
        recent={recentColors}
        onRecentUse={(hex) => setRecentColors((was) => rememberColor(was, hex))}
        onChooseImage={chooseImage}
        version={inspector.version}
        focusKey={focusSetting}
        hasFields={inspector.hasFields}
        tagPicker={{ tags: props.tags, channel: props.channel ?? 'EMAIL', recent: props.recentTags ?? [], onPick: props.onTagUsed }}
        receiptSlot={{ preset: props.receiptPreset ?? 'STANDARD', onPresetChange: props.onReceiptPresetChange, onOpenLayout: props.onOpenReceiptLayout }}
      />
      )}
      {code !== null ?
        <CodeDialog
          mjml={code.mjml}
          html={code.html}
          canEdit={!props.readOnly}
          onCheck={(text) => {
            const editor = editorRef.current
            // no editor means nothing could compile the code, which is itself a reason not to apply it
            return editor ? checkMjml(text, { compile: compileWith(editor), catalogue: props.tags, channel: props.channel ?? 'EMAIL' }) : { ok: false, message: 'The editor is not ready.', details: [] }
          }}
          onApply={applyMjml}
          onDownloadHtml={downloadHtml}
          onDownloadMjml={downloadMjml}
          onToast={(tone, title, detail) => (tone === 'success' ? latest.current.onSuccess?.(title, detail) : latest.current.onError(title, detail))}
          onClose={() => setCode(null)}
        />
      : null}
      {canvasTagButton && createPortal(<Braces size={16} strokeWidth={1.5} aria-hidden />, canvasTagButton)}
      <TagPickerPopover
        dropdown={canvasPicker}
        id="canvas"
        anchor={canvasTagButton}
        tags={props.tags}
        channel={props.channel ?? 'EMAIL'}
        recent={props.recentTags ?? []}
        onPick={insertTagOnCanvas}
      />
      {picking && (
        <ImagePicker
          assets={library}
          uploading={uploading}
          onUpload={(files) => {
            applyNextUpload.current = true
            uploadFiles(files)
          }}
          onChoose={applyPicked}
          onClose={cancelPicking}
        />
      )}
    </div>
  )
})

/** Drops one matching name, so two uploads of the same file clear their placeholders one at a time. */
function removeFirst(names: string[], name: string): string[] {
  const at = names.indexOf(name)
  return at === -1 ? names : [...names.slice(0, at), ...names.slice(at + 1)]
}

/** The component tree in the shape insertTarget reasons about, each node keeping its component. */
interface MappedNode extends InsertNode {
  component: Component
  children: MappedNode[]
}

/** A receipt's own blocks sit in mj-body the way sections do, so an insert treats them as sections. */
function toTree(component: Component): MappedNode {
  const type = String(component.get('type') ?? '')
  return { type: RECEIPT_BODY_TYPES.has(type) ? 'mj-section' : type, component, children: component.components().map(toTree) }
}

/** The selected component's child indices from mj-body down, or null when it is not in the tree. */
function pathTo(root: MappedNode, selected: Component | undefined): number[] | null {
  if (!selected) return null
  const search = (node: MappedNode, trail: number[]): number[] | null => {
    for (const [index, child] of node.children.entries()) {
      if (child.component === selected) return [...trail, index]
      const found = search(child, [...trail, index])
      if (found) return found
    }
    return null
  }
  return search(root, [])
}
