/**
 * GrapesJS + MJML email editor. Deliberately knows nothing about the CEP API: data comes in through props and goes
 * out through the imperative handle, so the same component runs in the page, the dev playground and tests.
 *
 *   load    editor_state (GrapesJS project JSON) when a version exists, otherwise the MJML (starter or imported)
 *   save    getDesign() -> { editor_state, mjml_source }. The server renders the HTML that is stored and sent.
 *   preview compileHtml() -> HTML from mjml-browser, only ever shown inside a sandboxed iframe.
 */
import grapesjs, { type Editor, type Plugin, type ProjectData } from 'grapesjs'
import grapesjsMjmlModule from 'grapesjs-mjml'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import 'grapesjs/dist/css/grapes.min.css'
import './designer.css'

import type { PersonalizationTag } from '@/lib/types'

import { asToken, groupTags } from './tags'

// grapesjs-mjml ships as a UMD bundle: depending on the bundler the default import is the plugin or a { default } wrapper.
type MjmlPlugin = Plugin<{ resetDevices?: boolean; useCustomTheme?: boolean }>
const grapesjsMjml: MjmlPlugin = (grapesjsMjmlModule as unknown as { default?: MjmlPlugin }).default ?? (grapesjsMjmlModule as unknown as MjmlPlugin)

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
  compileHtml: () => { html: string; errors: string[] }
  load: (design: { editor_state?: ProjectData | null; mjml_source?: string | null }) => void
  markSaved: () => void
  insertText: (text: string) => boolean
}

interface EmailDesignerProps {
  initialState?: ProjectData | null
  initialMjml: string
  tags: PersonalizationTag[]
  channel?: string
  assets: DesignerAsset[]
  /** uploads one image and resolves to where it is hosted */
  onUploadAsset: (file: File) => Promise<DesignerAsset>
  onDirtyChange: (dirty: boolean) => void
  onError: (message: string) => void
  readOnly?: boolean
}

/** A stored state is only usable when it is a GrapesJS project (has pages). Imported or migrated templates carry
 *  other shapes or nothing at all: those open from their MJML instead of as a blank canvas. */
function isProject(state: ProjectData | null | undefined): state is ProjectData {
  return Boolean(state) && Array.isArray((state as { pages?: unknown }).pages) && (state as { pages: unknown[] }).pages.length > 0
}

function tagMenuHtml(tags: PersonalizationTag[], channel: string): string {
  const groups = groupTags(tags, channel)
    .map((group) => `<optgroup label="${group.label}">${group.tags.map((tag) => `<option value="${asToken(tag.tag_key)}">${tag.label}</option>`).join('')}</optgroup>`)
    .join('')
  return `<select class="cep-tag-menu" aria-label="Insert personalization tag"><option value="">{{ }} Insert tag</option>${groups}</select>`
}

export const EmailDesigner = forwardRef<EmailDesignerHandle, EmailDesignerProps>(function EmailDesigner(props, ref) {
  const container = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  // Callbacks change identity on every render of the page; the editor is created once and reads the latest through this.
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })

  useEffect(() => {
    if (!container.current) return
    const { initialState, initialMjml, tags, channel = 'EMAIL', assets, readOnly } = latest.current

    const editor = grapesjs.init({
      container: container.current,
      height: '100%',
      width: 'auto',
      fromElement: false,
      storageManager: false, // persistence is the page's job (versioned saves through the API)
      noticeOnUnload: false, // the page owns the unsaved-changes prompt
      // Options go to the plugin directly (pluginsOpts is keyed by plugin *name*, which a function plugin does not have).
      // useCustomTheme: false stops it injecting its own dark palette, so the skin comes from designer.css (Tailwind tokens).
      plugins: [(instance) => grapesjsMjml(instance, { resetDevices: true, useCustomTheme: false })],
      assetManager: {
        assets: assets.map((asset) => ({ type: 'image', src: asset.url, name: asset.name, width: asset.width ?? undefined, height: asset.height ?? undefined })),
        embedAsBase64: false, // inline images bloat the message past Gmail's 102 KB clip limit
        uploadFile: (event) => {
          const source = (event as DragEvent).dataTransfer?.files ?? (event.target as HTMLInputElement | null)?.files
          for (const file of Array.from(source ?? [])) {
            latest.current
              .onUploadAsset(file)
              .then((asset) => editor.AssetManager.add({ type: 'image', src: asset.url, name: asset.name }))
              .catch((error: unknown) => latest.current.onError(error instanceof Error ? error.message : 'Upload failed'))
          }
        },
      },
    })
    editorRef.current = editor

    // Personalization: a tag menu in the rich-text toolbar inserts {{tag_key}} at the caret.
    if (tags.length > 0) {
      editor.RichTextEditor.add('cep-tags', {
        icon: tagMenuHtml(tags, channel),
        event: 'change',
        attributes: { title: 'Insert personalization tag', style: 'width:auto;padding:0' },
        result: (rte, action) => {
          const select = action.btn?.querySelector('select')
          if (select?.value) rte.insertHTML(select.value)
          if (select) select.value = ''
        },
      })
    }

    try {
      if (isProject(initialState)) editor.loadProjectData(initialState)
      else editor.setComponents(initialMjml)
    } catch {
      editor.setComponents(initialMjml) // a project saved by an older editor build: fall back to its MJML
    }

    editor.on('load', () => {
      editor.clearDirtyCount()
      latest.current.onDirtyChange(false)
      if (readOnly) editor.getWrapper()?.onAll((component) => component.set({ editable: false, draggable: false, removable: false, selectable: false }))
    })
    editor.on('update', () => latest.current.onDirtyChange(editor.getDirtyCount() > 0))

    return () => {
      editorRef.current = null
      editor.destroy()
    }
  }, [])

  useImperativeHandle(ref, () => ({
    getDesign: () => {
      const editor = editorRef.current
      if (!editor) throw new Error('The editor is not ready')
      return { editor_state: editor.getProjectData(), mjml_source: editor.getHtml() }
    },
    compileHtml: () => {
      const editor = editorRef.current
      if (!editor) return { html: '', errors: ['The editor is not ready'] }
      const result = editor.runCommand('mjml-code-to-html') as { html?: string; errors?: { formattedMessage?: string; message?: string }[] } | undefined
      return { html: result?.html ?? '', errors: (result?.errors ?? []).map((error) => error.formattedMessage ?? error.message ?? 'MJML error') }
    },
    load: (design) => {
      const editor = editorRef.current
      if (!editor) return
      if (isProject(design.editor_state)) editor.loadProjectData(design.editor_state)
      else if (design.mjml_source) editor.setComponents(design.mjml_source)
      editor.UndoManager.clear()
    },
    markSaved: () => {
      editorRef.current?.clearDirtyCount()
      latest.current.onDirtyChange(false)
    },
    insertText: (text) => {
      // Only while a text component is being edited: the module keeps the live editor in globalRte and the text
      // view marks itself as editing, which is when the caret sits inside the canvas.
      const editor = editorRef.current
      const selected = editor?.getSelected()
      const editing = Boolean((selected?.view as { rteEnabled?: boolean } | undefined)?.rteEnabled)
      const rte = editor?.RichTextEditor.globalRte
      if (!editing || !rte) return false
      rte.insertHTML(text)
      return true
    },
  }))

  return <div ref={container} className="cep-designer h-full min-h-0" />
})
