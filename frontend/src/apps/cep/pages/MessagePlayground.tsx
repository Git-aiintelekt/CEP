/**
 * Development only (/dev/message and /dev/message?channel=MMS, not registered in production builds): the real
 * SMS / MMS workspace on an in-memory backend. No sign-in and no API.
 */
import { useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

import { extractTags, unknownTags } from '@/apps/cep/features/designer/tags'
import { MessageWorkspace, type MessageBackend } from '@/apps/cep/features/messaging/MessageWorkspace'
import { OPT_OUT_PATTERN, renderWithSamples, smsMetrics } from '@/apps/cep/features/messaging/sms'
import type { MediaAsset, Message, MessageSaveInput, PersonalizationTag } from '@/lib/types'

const tag = (tag_key: string, label: string, tag_kind: string, sample_value: string): PersonalizationTag => ({
  id: tag_key, tag_key, label, tag_kind, data_type: 'STRING', applies_to_channels: ['SMS', 'MMS'], description: null, sample_value,
  default_value: null, static_value: null, is_active: true,
})
const TAGS = [tag('first_name', 'First name', 'STANDARD', 'Jordan'), tag('loyalty_tier', 'Loyalty tier', 'STANDARD', 'Gold'), tag('offer_code', 'Offer code', 'CUSTOM', 'FALL017'),
              tag('discount_pct', 'Discount %', 'CUSTOM', '20'), tag('shop_url', 'Shop URL', 'SYSTEM', 'https://nwa.example/s/9x2')]

const image = (id: string, label: string, color: string, byte_size: number): MediaAsset => ({
  id, file_name: `${label.toLowerCase()}.png`, mime_type: 'image/png', byte_size, width_px: 600, height_px: 400, created_at: new Date().toISOString(),
  url: `https://placehold.co/600x400/${color}/ffffff/png?text=${label}`,
})
const LIBRARY = [image('m1', 'Lookbook', '2753e4', 180_000), image('m2', 'Sale', 'be123c', 720_000)]

export default function MessagePlayground() {
  const [params] = useSearchParams()
  const channel = params.get('channel') === 'MMS' ? 'MMS' : 'SMS'
  const versions = useRef<Message[]>([])

  const build = (input: MessageSaveInput, number: number, latest: number): Message => {
    const used = extractTags(input.sms_body)
    const media = LIBRARY.find((item) => item.id === input.media_asset) ?? null
    const metrics = smsMetrics(renderWithSamples(input.sms_body, TAGS))
    return {
      template: 'playground', channel, version_number: number, latest_version: latest, sms_body: input.sms_body.trim(), subject_line: input.subject_line,
      media_asset: media && { id: media.id, url: media.url, file_name: media.file_name, mime_type: media.mime_type, byte_size: media.byte_size, width_px: media.width_px, height_px: media.height_px },
      saved_at: new Date().toISOString(), saved_by: 'Playground',
      findings: { encoding: metrics.encoding, units: metrics.units, segments: metrics.segments, per_segment: metrics.perSegment, non_gsm_characters: metrics.nonGsmCharacters,
                  estimated: used.length > 0, tags_used: used, unknown_tags: unknownTags(used, TAGS), wrong_channel_tags: [], missing_opt_out: !OPT_OUT_PATTERN.test(input.sms_body),
                  long_message: metrics.segments > 3, has_link: /https?:/.test(input.sms_body), missing_media: channel === 'MMS' && !media, media_bytes: media?.byte_size ?? null,
                  media_heavy: (media?.byte_size ?? 0) > 600 * 1024 },
    }
  }

  const backend = useMemo<MessageBackend>(
    () => ({
      save: async (input) => {
        const latest = versions.current.length
        if (input.base_version !== latest) throw new Error(`Stale version (latest is ${latest})`)
        const saved = build(input, latest + 1, latest + 1)
        versions.current = [...versions.current, saved]
        return saved
      },
      loadVersion: async (number) => ({ ...versions.current[number - 1], latest_version: versions.current.length }),
      listVersions: async () => [...versions.current].reverse().map((item) => ({ version_number: item.version_number, saved_at: item.saved_at ?? '', saved_by: item.saved_by })),
      uploadMedia: async (file) => ({ ...image(`up-${file.name}`, 'Upload', '0f766e', file.size), file_name: file.name, mime_type: file.type, url: URL.createObjectURL(file) }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channel],
  )

  const empty = build({ sms_body: '', subject_line: '', media_asset: null, base_version: 0 }, 0, 0)
  return (
    <MessageWorkspace key={channel} templateName={`Playground ${channel}`} channel={channel} status="DRAFT" message={{ ...empty, saved_at: null, saved_by: null }}
      tags={TAGS} library={LIBRARY} senderName="Northwind" backend={backend} backTo="/templates" />
  )
}
