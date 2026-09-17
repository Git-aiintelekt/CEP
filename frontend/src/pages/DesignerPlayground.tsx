/**
 * Development only (/dev/designer, not registered in production builds): the real designer on an in-memory backend.
 * No sign-in and no API, so the editor can be worked on and checked visually in isolation.
 */
import { useMemo, useRef } from 'react'

import { DesignerWorkspace, type DesignerBackend } from '@/features/designer/DesignerWorkspace'
import { extractTags, unknownTags } from '@/features/designer/tags'
import type { Design, PersonalizationTag } from '@/lib/types'

const tag = (tag_key: string, label: string, tag_kind: string, sample_value: string): PersonalizationTag => ({
  id: tag_key, tag_key, label, tag_kind, data_type: 'STRING', applies_to_channels: ['EMAIL'], description: null, sample_value,
  default_value: null, static_value: null, is_active: true,
})

const TAGS = [
  tag('first_name', 'First name', 'STANDARD', 'Jordan'),
  tag('loyalty_tier', 'Loyalty tier', 'STANDARD', 'Gold'),
  tag('offer_code', 'Offer code', 'CUSTOM', 'FALL017'),
  tag('discount_pct', 'Discount %', 'CUSTOM', '20'),
  tag('client_logo', 'Client logo', 'STANDARD', 'https://placehold.co/320x80/2753e4/ffffff/png?text=Northwind'),
  tag('shop_url', 'Shop URL', 'SYSTEM', 'https://shop.example.com'),
  tag('unsubscribe_url', 'Unsubscribe URL', 'SYSTEM', 'https://example.com/unsubscribe'),
]

const EMPTY: Design = {
  template: 'playground', version_number: 0, latest_version: 0, editor_state: null, mjml_source: null, html_content: null,
  text_content: null, subject_line: '', preheader: '', saved_at: null, saved_by: null,
}

export default function DesignerPlayground() {
  const versions = useRef<Design[]>([])

  const backend = useMemo<DesignerBackend>(
    () => ({
      save: async (input) => {
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
    }),
    [],
  )

  return <DesignerWorkspace templateName="Playground template" channel="EMAIL" status="DRAFT" design={EMPTY} tags={TAGS} assets={[]} backend={backend} backTo="/templates" />
}
