/**
 * Development only (/dev/receipt, not registered in production builds): the real receipt editor on an in-memory
 * backend. No sign-in and no API, so the editor can be worked on and checked visually in isolation.
 * ?state= readonly | conflict | loading | failed puts each state on screen without a server behind it.
 * ?preset=receipt_bopis opens an e-receipt preset the way a fresh copy of it opens: its outer design and its layout.
 */
import { useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

import { offlineSample } from '@/apps/cep/features/designer/blocks/codes'
import { EditorFailure, EditorLoading } from '@/apps/cep/features/designer/EditorStates'
import { ReceiptWorkspace, type ReceiptBackend } from '@/apps/cep/features/receipt/ReceiptWorkspace'
import { defaultSectionsFor } from '@/apps/cep/features/receipt/receiptPresets'
import { RECEIPT_STARTER_MJML } from '@/apps/cep/features/receipt/receiptStarter'
import { RECEIPT_PRESETS } from '@/apps/cep/features/templates/presets'
import { ApiError } from '@/lib/api'
import type { Design, DesignVersion, PersonalizationTag, ReceiptLayout } from '@/lib/types'

const tag = (tag_key: string, label: string, tag_kind: string, sample_value: string, default_value: string | null = null): PersonalizationTag => ({
  id: tag_key, tag_key, label, tag_kind, data_type: 'STRING', applies_to_channels: ['E_RECEIPT'], description: null, sample_value,
  default_value, static_value: null, is_active: true,
})

const TAGS = [
  // a workspace default, as the Email playground has, so the fallback check has something to name
  tag('first_name', 'First name', 'STANDARD', 'Jordan', 'there'),
  tag('order_number', 'Order number', 'SYSTEM', 'NL-100482'),
  tag('order_total', 'Order total', 'SYSTEM', '$84.20'),
  tag('store_name', 'Store name', 'STANDARD', 'Northline Market'),
  tag('shop_url', 'Shop URL', 'SYSTEM', 'https://shop.example.com'),
  // the receipt tags the server adds to a workspace (REQUIRED_TAGS in apps/templates/starters.py), with its samples
  tag('receipt_number', 'Receipt number', 'SYSTEM', 'R-104-88213'),
  tag('grand_total', 'Total', 'SYSTEM', '$72.58'),
  tag('delivery_estimate', 'Delivery estimate', 'SYSTEM', 'Tuesday, Sep 22'),
  // the coupon tags patch 0024 gives every workspace; a receipt fills them from its own coupon_* fields
  tag('coupon_code', 'Coupon Code', 'CUSTOM', 'SAVE20-7K3Q'),
  tag('coupon_barcode_value', 'Coupon Barcode Value', 'CUSTOM', 'CPN400012345678'),
  tag('coupon_qr_value', 'Coupon QR Value', 'CUSTOM', 'https://shop.example.com/c/SAVE20-7K3Q'),
]

/** One picture, so the Image block has something to start from. */
const ASSETS = [{ url: '/favicon.svg', name: 'favicon.svg' }]

const EMPTY_DESIGN: Design = {
  template: 'playground', version_number: 0, latest_version: 0, editor_state: null, mjml_source: RECEIPT_STARTER_MJML, html_content: null,
  text_content: null, subject_line: 'Your Northline receipt', preheader: '', saved_at: null, saved_by: null,
}

const EMPTY_LAYOUT: ReceiptLayout = {
  template: 'playground', version_number: 0, latest_version: 0, layout_preset: 'STANDARD', sections: defaultSectionsFor('STANDARD'),
  custom_html: null, custom_css: null, saved_at: null, saved_by: null,
}

const CONFLICT = () => new ApiError(409, { title: 'Conflict', detail: 'Someone else saved while you were editing.' })

function historyOf(saved: { version_number: number; saved_at: string | null; saved_by: string | null }[]): DesignVersion[] {
  return [...saved].reverse().map((item) => ({ version_number: item.version_number, saved_at: item.saved_at ?? '', saved_by: item.saved_by }))
}

export default function ReceiptPlayground() {
  const designs = useRef<Design[]>([])
  const layouts = useRef<ReceiptLayout[]>([])
  const [params] = useSearchParams()
  const state = params.get('state')
  const preset = RECEIPT_PRESETS.find((item) => item.key === params.get('preset'))?.content
  const design = useMemo<Design>(
    () => (preset?.kind === 'receipt' ? { ...EMPTY_DESIGN, editor_state: { kind: 'preset', key: params.get('preset') }, mjml_source: preset.mjml, subject_line: preset.subject_line, preheader: preset.preheader } : EMPTY_DESIGN),
    [preset, params],
  )
  const receiptLayout = useMemo<ReceiptLayout>(
    () => (preset?.kind === 'receipt' ? { ...EMPTY_LAYOUT, layout_preset: preset.layout_preset, sections: preset.sections } : EMPTY_LAYOUT),
    [preset],
  )

  const backend = useMemo<ReceiptBackend>(
    () => ({
      saveDesign: async (input) => {
        if (state === 'conflict') throw CONFLICT()
        const latest = designs.current.length
        if (input.base_version !== latest) throw new ApiError(409, { title: 'Conflict', detail: `Stale version (latest is ${latest})` })
        const saved: Design = { ...EMPTY_DESIGN, ...input, version_number: latest + 1, latest_version: latest + 1, saved_at: new Date().toISOString(), saved_by: 'Playground' }
        designs.current = [...designs.current, saved]
        return saved
      },
      loadDesignVersion: async (number) => ({ ...designs.current[number - 1], latest_version: designs.current.length }),
      listDesignVersions: async () => historyOf(designs.current),
      saveReceiptLayout: async (input) => {
        const latest = layouts.current.length
        if (input.base_version !== latest) throw new ApiError(409, { title: 'Conflict', detail: `Stale version (latest is ${latest})` })
        const saved: ReceiptLayout = { ...EMPTY_LAYOUT, ...input, version_number: latest + 1, latest_version: latest + 1, saved_at: new Date().toISOString(), saved_by: 'Playground' }
        layouts.current = [...layouts.current, saved]
        return saved
      },
      loadReceiptLayoutVersion: async (number) => ({ ...layouts.current[number - 1], latest_version: layouts.current.length }),
      listReceiptLayoutVersions: async () => historyOf(layouts.current),
      uploadAsset: async (file) => ({ url: URL.createObjectURL(file), name: file.name }),
      activate: async () => {},
      // no server here: the code blocks are offered (?codes=off hides them) and show the browser's stand-in
      sampleCode: params.get('codes') === 'off' ? undefined : offlineSample,
    }),
    [state, params],
  )

  if (state === 'loading') return <EditorLoading label="Opening the receipt editor" />
  if (state === 'failed') {
    return <EditorFailure title="Couldn’t load this template" detail="The server did not answer. Your last saved version is safe." onRetry={() => {}} />
  }

  return (
    <ReceiptWorkspace
      templateName="Playground receipt"
      status="DRAFT"
      design={design}
      receiptLayout={receiptLayout}
      tags={TAGS}
      assets={ASSETS}
      backend={backend}
      backTo="/templates"
      readOnly={state === 'readonly'}
    />
  )
}
