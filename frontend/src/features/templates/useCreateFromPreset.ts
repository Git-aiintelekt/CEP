/**
 * Clicking a preset makes a Draft copy straight away and opens it: no confirmation (design.md §10).
 * A preset the frontend owns is copied in two calls, create then fill; a server-only preset in one, with `starter`.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { useToast } from '@/components/Toast'
import { api, ApiError } from '@/lib/api'
import { editorPathFor } from '@/lib/editorRoute'
import { loadingOverlay } from '@/lib/loadingOverlay'
import type { DesignSaveInput, MessageSaveInput, Preset, PresetContent, ReceiptLayoutSaveInput, Template } from '@/lib/types'

const MAX_TRIES = 10
const OVERLAY_FADE_MS = 600

const nameClash = (error: unknown) => error instanceof ApiError && error.status === 400 && Boolean(error.fieldErrors.name)

/** "Sale announcement", then "Sale announcement 2", "3"... while the name is taken. */
async function createCopy(preset: Preset): Promise<Template> {
  for (let attempt = 1; ; attempt += 1) {
    const name = attempt === 1 ? preset.name : `${preset.name} ${attempt}`
    try {
      return await api.post<Template>('/templates/', { name, channel: preset.channel, ...(preset.content ? {} : { starter: preset.key }) })
    } catch (error) {
      if (!nameClash(error) || attempt >= MAX_TRIES) throw error
    }
  }
}

/** Version 1 of the copy, saved through the same endpoints the editors use. An e-receipt saves its outer design, then its layout. */
async function fill(template: Template, key: string, content: PresetContent): Promise<void> {
  if (content.kind === 'message') {
    const input: MessageSaveInput = { sms_body: content.sms_body, subject_line: content.subject_line, media_asset: null, base_version: 0 }
    await api.post(`/templates/${template.id}/message/`, input)
    return
  }
  const design: DesignSaveInput = { editor_state: { kind: 'preset', key }, mjml_source: content.mjml, subject_line: content.subject_line, preheader: content.preheader, base_version: 0 }
  await api.post(`/templates/${template.id}/design/`, design)
  if (content.kind === 'receipt') {
    const layout: ReceiptLayoutSaveInput = { layout_preset: content.layout_preset, sections: content.sections, custom_html: null, custom_css: null, base_version: 0 }
    await api.post(`/templates/${template.id}/receipt/`, layout)
  }
}

export function useCreateFromPreset() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()

  return async (preset: Preset) => {
    loadingOverlay.show(`Creating ${preset.name}`)
    let created: Template
    try {
      created = await createCopy(preset)
    } catch (error) {
      loadingOverlay.hide()
      const detail = nameClash(error) ? `Every name from "${preset.name}" to "${preset.name} ${MAX_TRIES}" is taken. Rename one of them and try again.` : error instanceof Error ? error.message : undefined
      toast.error(`Could not create a template from ${preset.name}`, detail)
      return
    }

    if (preset.content) {
      try {
        await fill(created, preset.key, preset.content)
      } catch (error) {
        // the Draft exists and stays: the editor opens on it empty, nothing is archived or deleted
        toast.error(`We couldn't add the ${preset.name} content. Your draft ${created.name} is empty.`, error instanceof Error ? error.message : undefined)
      }
    }

    await queryClient.invalidateQueries({ queryKey: ['templates'] })
    navigate(editorPathFor(created))
    loadingOverlay.fadeOut()
    window.setTimeout(() => loadingOverlay.hide(), OVERLAY_FADE_MS)
  }
}
