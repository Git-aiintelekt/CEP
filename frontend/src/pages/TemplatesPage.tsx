/** /templates : the Templates landing page, an exact copy of Templates.dc.html (content area only). */
import { useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { TEMPLATE_CHANNELS, type TemplateChannel } from '@/features/templates/channels'
import { NewTemplateModal } from '@/features/templates/NewTemplateModal'
import { QuickCreateCards } from '@/features/templates/QuickCreateCards'
import { TemplateLibrary } from '@/features/templates/TemplateLibrary'
import { channelAllowed } from '@/lib/features'

import { PageHelp } from '@/help/HelpPanel'

export function TemplatesPage() {
  const { can, has } = useAuth()
  const canEdit = can('template.edit')
  const channels = TEMPLATE_CHANNELS.filter((channel) => channelAllowed(has, channel))
  const [creating, setCreating] = useState<TemplateChannel | null>(null)

  return (
    // the shell's <main> already gives the page its white ground and padding
    <div className="flex flex-col gap-8">
      <section className="rounded-lg bg-brand-600 px-[clamp(20px,2vw,32px)] pt-7 pb-8">
        <span className="flex items-center gap-1.5"><h1 className="font-display text-page-title font-semibold text-white">Templates</h1><PageHelp chapter="templates" onBrand /></span>
        <p className="mt-1 text-sm leading-normal text-brand-100">Start a new message from a channel, or pick up a template from your library below.</p>
        {canEdit && channels.length > 0 && <QuickCreateCards channels={channels} onPick={setCreating} />}
      </section>

      <TemplateLibrary channels={channels} canEdit={canEdit} />

      {creating && <NewTemplateModal channel={creating} onClose={() => setCreating(null)} />}
    </div>
  )
}
