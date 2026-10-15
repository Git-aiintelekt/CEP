/**
 * The only place that knows where presets come from: the frontend's own definitions (./presets), merged with the
 * server's template starters (GET /template-starters/?channel=). A definition wins over a starter with the same key;
 * a starter with no definition (the e-receipts) passes through and is still copied by the server.
 */
import { useQueries, useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { Page, PersonalizationTag, Preset, PresetContent, TemplateStarter } from '@/lib/types'

import { PRESET_DEFINITIONS, type PresetDefinition } from './presets'
import { receiptSectionTags } from './presets/receiptTags'

const TAG = /\{\{\s*([\w.]+)/g

function tagsIn(...texts: (string | null | undefined)[]): string[] {
  const text = texts.filter(Boolean).join('\n')
  return [...new Set(Array.from(text.matchAll(TAG), (match) => match[1]))]
}

function contentTags(content: PresetContent): string[] {
  if (content.kind === 'message') return tagsIn(content.subject_line, content.sms_body)
  const outer = tagsIn(content.subject_line, content.preheader, content.mjml)
  return content.kind === 'receipt' ? [...new Set([...outer, ...receiptSectionTags(content.sections)])] : outer
}

export function presetFromStarter(starter: TemplateStarter): Preset {
  return {
    key: starter.key,
    name: starter.name,
    channel: starter.channel,
    category: starter.category,
    description: starter.description,
    governanceClass: starter.channel === 'E_RECEIPT' ? 'TRANSACTIONAL' : undefined,
    requiredTags: tagsIn(starter.subject_line, starter.preheader, starter.html_content, starter.sms_body),
    isSystem: true,
  }
}

export function presetFromDefinition(definition: PresetDefinition): Preset {
  const { content, ...rest } = definition
  return { ...rest, content, governanceClass: content.kind === 'receipt' ? 'TRANSACTIONAL' : 'MARKETING', requiredTags: contentTags(content), isSystem: true }
}

/** Server starters with frontend definitions swapped in by key, then any definition the server does not list. */
export function mergePresets(starters: TemplateStarter[], definitions: PresetDefinition[]): Preset[] {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]))
  const merged = starters.map((starter) => {
    const definition = byKey.get(starter.key)
    return definition ? presetFromDefinition(definition) : presetFromStarter(starter)
  })
  const listed = new Set(starters.map((starter) => starter.key))
  return [...merged, ...definitions.filter((definition) => !listed.has(definition.key)).map(presetFromDefinition)]
}

/**
 * Whether a workspace is offered a preset: it has every tag the preset uses. E-receipt presets are the exception and
 * always offered: their tags are receipt data the server adds to a workspace when a receipt is first copied, so
 * gating on them would hide the presets from exactly the workspaces that need them first.
 */
export function offerable(preset: Preset, known: Set<string>): boolean {
  return preset.content?.kind === 'receipt' || preset.requiredTags.every((key) => known.has(key))
}

/** Presets for these channels that the workspace can fill (see offerable). */
export function usePresets(channels: string[]): { presets: Preset[]; isPending: boolean } {
  const starters = useQueries({
    queries: channels.map((channel) => ({
      queryKey: ['template-starters', channel],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<TemplateStarter[]>('/template-starters/', { channel }, signal),
      staleTime: 10 * 60_000,
    })),
  })
  const tags = useQuery({
    queryKey: ['personalization-tags', 'all'],
    queryFn: ({ signal }) => api.get<Page<PersonalizationTag>>('/personalization-tags/', { page_size: 200 }, signal),
  })

  const known = new Set((tags.data?.results ?? []).map((tag) => tag.tag_key))
  const presets = tags.data
    ? channels
        .flatMap((channel, index) => mergePresets(starters[index]?.data ?? [], PRESET_DEFINITIONS.filter((definition) => definition.channel === channel)))
        .filter((preset) => offerable(preset, known))
    : []
  return { presets, isPending: tags.isPending || starters.some((query) => query.isPending) }
}
