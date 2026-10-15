/**
 * Stands in for the Outer design canvas in tests: GrapesJS hangs under jsdom. It keeps the same handle, so the
 * workspace saves, loads and compiles through it exactly as it would through the real one.
 * Swap it in with vi.mock('@/apps/cep/features/receipt/OuterDesignPane', () => import('@/test/fakeOuterDesignPane')); read and
 * steer it through ./fakeCanvas.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

import type { EmailDesignerHandle } from '@/apps/cep/features/designer/EmailDesigner'

import { fakeCanvas, fakeCompiled } from './fakeCanvas'

interface FakeProps {
  initialMjml: string
  onDirtyChange: (dirty: boolean) => void
  onCanvasChange?: () => void
  onOpenReceiptLayout: () => void
  readOnly?: boolean
}

export const OuterDesignPane = forwardRef<EmailDesignerHandle, FakeProps>(function FakeOuterDesignPane(props, ref) {
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })
  useEffect(() => {
    fakeCanvas.mounts += 1
    fakeCanvas.mjml = props.initialMjml
  }, [props.initialMjml])

  useImperativeHandle(ref, () => ({
    getDesign: () => ({ editor_state: { pages: [{ id: 'fake' }] }, mjml_source: fakeCanvas.mjml }),
    getMjml: () => fakeCanvas.mjml,
    compileHtml: () => ({ html: fakeCompiled(fakeCanvas.mjml), errors: [] }),
    load: (design) => {
      fakeCanvas.loaded.push(design)
      fakeCanvas.mjml = design.mjml_source ?? ''
    },
    markSaved: () => latest.current.onDirtyChange(false),
    openTagsPanel: () => {},
    insertBlock: () => null,
    commitEdit: async () => {},
    revealSetting: () => false,
  }))

  return (
    <div data-testid="outer-canvas">
      <button
        type="button"
        disabled={props.readOnly}
        onClick={() => {
          fakeCanvas.mjml = fakeCanvas.mjml.replace(/<mj-section css-class="cep-receipt-footer"[\s\S]*?<\/mj-section>/, '')
          props.onDirtyChange(true)
          props.onCanvasChange?.()
        }}
      >
        Remove the footer
      </button>
      <button type="button" onClick={props.onOpenReceiptLayout}>
        Open Receipt Layout
      </button>
    </div>
  )
})
