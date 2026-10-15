/**
 * Development only (/dev/designer, not registered in production builds): the real designer on an in-memory backend.
 * No sign-in and no API, so the editor can be worked on and checked visually in isolation.
 */
import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { offlineSample } from '@/apps/cep/features/designer/blocks/codes'
import { sampleDeliverability } from '@/apps/cep/features/deliverability/backend'
import { DesignerWorkspace, type DesignerBackend } from '@/apps/cep/features/designer/DesignerWorkspace'
import { EditorFailure, EditorLoading } from '@/apps/cep/features/designer/EditorStates'
import { extractTags, unknownTags } from '@/apps/cep/features/designer/tags'
import { PRESET_DEFINITIONS } from '@/apps/cep/features/templates/presets'
import { ApiError } from '@/lib/api'
import type { Design, PersonalizationTag } from '@/lib/types'

const tag = (tag_key: string, label: string, tag_kind: string, sample_value: string, default_value: string | null = null): PersonalizationTag => ({
  id: tag_key, tag_key, label, tag_kind, data_type: 'STRING', applies_to_channels: ['EMAIL'], description: null, sample_value,
  default_value, static_value: null, is_active: true,
})

const TAGS = [
  // one tag with a workspace default and the rest without, so the picker shows both of its fallback lines
  tag('first_name', 'First name', 'STANDARD', 'Jordan', 'there'),
  tag('loyalty_tier', 'Loyalty tier', 'STANDARD', 'Gold'),
  tag('loyalty_points', 'Loyalty points', 'STANDARD', '1,250'),
  tag('offer_code', 'Offer code', 'CUSTOM', 'FALL017'),
  tag('discount_pct', 'Discount %', 'CUSTOM', '20'),
  tag('client_logo', 'Client logo', 'STANDARD', 'https://placehold.co/320x80/2753e4/ffffff/png?text=Northwind'),
  tag('shop_url', 'Shop URL', 'SYSTEM', 'https://shop.example.com'),
  tag('unsubscribe_url', 'Unsubscribe URL', 'SYSTEM', 'https://example.com/unsubscribe'),
  // the coupon tags patch 0024 gives every workspace, which the barcode and QR code blocks read
  tag('coupon_code', 'Coupon Code', 'CUSTOM', 'SAVE20-7K3Q'),
  tag('coupon_barcode_value', 'Coupon Barcode Value', 'CUSTOM', 'CPN400012345678'),
  tag('coupon_qr_value', 'Coupon QR Value', 'CUSTOM', 'https://shop.example.com/c/SAVE20-7K3Q'),
]

const EMPTY: Design = {
  template: 'playground', version_number: 0, latest_version: 0, editor_state: null, mjml_source: null, html_content: null,
  text_content: null, subject_line: '', preheader: '', saved_at: null, saved_by: null,
}

export default function DesignerPlayground() {
  const versions = useRef<Design[]>([])
  // ?state= readonly | conflict | loading | failed puts each state on screen without a server behind it
  const [params] = useSearchParams()
  const state = params.get('state')
  // ?preset=welcome opens an email preset the way a fresh copy of it opens: a non-GrapesJS editor_state, so from its MJML
  const preset = PRESET_DEFINITIONS.find((item) => item.key === params.get('preset'))?.content
  const design = useMemo<Design>(
    () => (preset?.kind === 'design' ? { ...EMPTY, editor_state: { kind: 'preset', key: params.get('preset') }, mjml_source: preset.mjml, subject_line: preset.subject_line, preheader: preset.preheader } : EMPTY),
    [preset, params],
  )

  const [deliverability] = useState(() => sampleDeliverability())
  const backend = useMemo<DesignerBackend>(
    () => ({
      save: async (input) => {
        if (state === 'conflict') throw new ApiError(409, { title: 'Conflict', detail: 'Someone else saved while you were editing.' })
        const latest = versions.current.length
        if (input.base_version !== latest) throw new Error(`Stale version (latest is ${latest})`)
        const used = extractTags(input.subject_line, input.preheader, input.mjml_source)
        const saved: Design = {
          ...EMPTY, ...input, version_number: latest + 1, latest_version: latest + 1, saved_at: new Date().toISOString(), saved_by: 'Playground',
          findings: { tags_used: used, unknown_tags: unknownTags(used, TAGS), missing_unsubscribe: !used.includes('unsubscribe_url'),
                      missing_subject: !input.subject_line.trim(), html_bytes: input.mjml_source.length, may_be_clipped: false },
        }
        versions.current = [...versions.current, saved]
        return saved
      },
      loadVersion: async (number) => ({ ...versions.current[number - 1], latest_version: versions.current.length }),
      listVersions: async () => [...versions.current].reverse().map((item) => ({ version_number: item.version_number, saved_at: item.saved_at ?? '', saved_by: item.saved_by })),
      uploadAsset: async (file) => ({ url: URL.createObjectURL(file), name: file.name }),
      // no server here: the code blocks are offered (?codes=off hides them) and show the browser's stand-in
      sampleCode: params.get('codes') === 'off' ? undefined : offlineSample,
      deliverability,
    }),
    [state, params, deliverability],
  )

  if (state === 'loading') return <EditorLoading label="Opening the designer" />
  if (state === 'failed') {
    return <EditorFailure title="Couldn’t load this template" detail="The server did not answer. Your last saved version is safe." onRetry={() => {}} />
  }

  return (
    <DesignerWorkspace
      templateName="Playground template"
      channel="EMAIL"
      status="DRAFT"
      design={design}
      tags={TAGS}
      assets={[]}
      backend={backend}
      backTo="/templates"
      readOnly={state === 'readonly'}
      showNav={params.get('nav') === '1'}
    />
  )
}
