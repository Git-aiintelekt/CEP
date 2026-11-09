/**
 * Development only (/dev/whatsapp, ?state=approved | rejected | synced; not registered in production builds): the real WhatsApp
 * template editor on an in-memory backend. Submit to Meta answers In Review; nothing leaves the browser.
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { extractTags } from '@/apps/cep/features/designer/tags'
import { WhatsAppWorkspace, type WhatsAppBackend, type WhatsAppSaveInput } from '@/apps/cep/features/messaging/WhatsAppWorkspace'
import type { PersonalizationTag, WhatsAppTemplate } from '@/lib/types'

const tag = (tag_key: string, label: string, tag_kind: string, sample_value: string, default_value: string | null = null): PersonalizationTag => ({
  id: tag_key, tag_key, label, tag_kind, data_type: 'STRING', applies_to_channels: ['SMS', 'MMS', 'WHATSAPP'], description: null, sample_value,
  default_value, static_value: null, is_active: true,
})
const TAGS = [tag('first_name', 'First Name', 'STANDARD', 'Mei Ling', 'there'), tag('preferred_store', 'Preferred Store', 'STANDARD', 'Harbour Mall'),
              tag('product_name', 'Product Name', 'CUSTOM', 'Linen Shirt, Navy'), tag('points_balance', 'Points Balance', 'CUSTOM', '1,200')]
const NUMBERS = [{ engine: 'wa-1', label: '+6568124400 · City HT', name: 'City HT' }]

const BASE: WhatsAppTemplate = {
  template: 'playground', name: 'Back in Stock', status: 'DRAFT', version_number: 1, engine: 'wa-1', engine_name: 'City HT WhatsApp', meta_name: 'back_in_stock',
  language: 'en', category: 'MARKETING', header_type: 'IMAGE', header_text: '', header_media: { id: 'm1', url: 'https://placehold.co/600x300/0f766e/ffffff/png?text=Back+in+stock', file_name: 'back-in-stock.png', mime_type: 'image/png', byte_size: 120_000 },
  body: "Good news, {{first_name}}: the {{product_name}} you asked about is back at {{preferred_store}}. We'll hold one for you until Sunday.",
  meta_body: "Good news, {{1}}: the {{2}} you asked about is back at {{3}}. We'll hold one for you until Sunday.", footer_text: 'City HT · Reply STOP to opt out',
  buttons: [{ type: 'URL', text: 'Reserve It', url: 'https://cityht.example/reserve' }, { type: 'QUICK_REPLY', text: 'Stop Offers' }],
  variables: [{ tag: 'first_name', sample: 'Mei Ling', fallback: 'there' }, { tag: 'product_name', sample: 'Linen Shirt, Navy', fallback: 'item' }, { tag: 'preferred_store', sample: 'Harbour Mall', fallback: 'your City HT store' }],
  origin: 'CEP', meta_status: 'DRAFT', meta_reason: null, meta_quality: null, meta_template_id: null, submitted_at: null, decided_at: null, synced_at: null, editable: true, row_version: 1,
  findings: { characters: 98, max_characters: 1024, tags_used: ['first_name', 'product_name', 'preferred_store'], unknown_tags: [], starts_or_ends_with_tag: false, adjacent_tags: false, too_many_tags: false, missing_opt_out: false },
}

const STATES: Record<string, Partial<WhatsAppTemplate>> = {
  approved: { meta_status: 'APPROVED', editable: false, status: 'ACTIVE', submitted_at: '2026-11-04T08:40:00Z', decided_at: '2026-11-04T08:52:00Z', meta_template_id: '9001' },
  rejected: { meta_status: 'REJECTED', meta_reason: 'INVALID_FORMAT: the message may not end with a variable', meta_template_id: '9001' },
  synced: { name: 'Points Balance (en)', origin: 'META', meta_status: 'APPROVED', editable: false, category: 'UTILITY', header_type: 'NONE', header_media: null, footer_text: '', buttons: [],
            meta_name: 'points_balance', meta_body: 'Hi {{1}}, you have {{2}} points. They are worth money off your next visit.', body: 'Hi {{first_name}}, you have {{2}} points. They are worth money off your next visit.',
            variables: [{ tag: 'first_name', sample: 'Mei', fallback: '' }, { tag: '', sample: '1,200', fallback: '' }], synced_at: '2026-11-05T02:10:00Z' },
}

export default function WhatsAppPlayground() {
  const [params] = useSearchParams()
  const start = useMemo(() => ({ ...BASE, ...(STATES[params.get('state') ?? ''] ?? {}) }), [params])
  const [template] = useState(start)

  const backend = useMemo<WhatsAppBackend>(() => {
    let current = template
    const save = async (input: WhatsAppSaveInput) => {
      const order = extractTags(input.body)
      let n = 0
      const numbers = new Map(order.map((key) => [key, ++n]))
      current = {
        ...current, version_number: current.version_number + 1, meta_name: input.meta_name, language: input.language, category: input.category, header_type: input.header_type,
        header_text: input.header_text, body: input.body, footer_text: input.footer_text, buttons: input.buttons, engine: input.engine,
        meta_body: input.body.replace(/\{\{\s*([a-z_][a-z0-9_.]*)\s*\}\}/gi, (_whole, key: string) => `{{${numbers.get(key) ?? 0}}}`),
        variables: current.origin === 'META' ? current.variables.map((v, i) => ({ ...v, tag: input.variable_tags?.[i] ?? v.tag }))
          : order.map((key) => ({ tag: key, sample: input.samples[key] ?? '', fallback: input.fallbacks[key] ?? '' })),
        meta_status: current.origin === 'META' ? current.meta_status : 'DRAFT',
      }
      return current
    }
    return {
      save,
      submit: async () => (current = { ...current, meta_status: 'PENDING', editable: false, submitted_at: new Date().toISOString(), meta_template_id: '9001' }),
      activate: async () => undefined,
      copy: async () => 'playground-copy',
      uploadMedia: async (file) => ({ id: 'm2', file_name: file.name, mime_type: file.type, byte_size: file.size, width_px: null, height_px: null, created_at: new Date().toISOString(), url: URL.createObjectURL(file) }),
    }
  }, [template])

  return <WhatsAppWorkspace key={params.get('state') ?? 'draft'} templateName={template.name} status={template.status} template={template} tags={TAGS} numbers={NUMBERS}
    backend={backend} backTo="/dev/whatsapp" onCopied={() => window.alert('A copy would open now.')} />
}
