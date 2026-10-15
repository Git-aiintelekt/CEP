/** /templates : the Templates landing page, an exact copy of Templates.dc.html (content area only). */
import { useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { TEMPLATE_CHANNELS, type TemplateChannel } from '@/apps/cep/features/templates/channels'
import { CreateTemplateModal } from '@/apps/cep/features/templates/CreateTemplateModal'
import { QuickCreateCards } from '@/apps/cep/features/templates/QuickCreateCards'
import { TemplateLibrary } from '@/apps/cep/features/templates/TemplateLibrary'
import { channelAllowed } from '@/lib/features'

import { PageHelp } from '@/apps/cep/help/HelpPanel'

export function TemplatesPage() {
  const { can, has } = useAuth()
  const canEdit = can('template.edit')
  // E-Receipt is always offered, as on Create Campaign (2026-10-08); the other channels follow the workspace switches
  const channels = TEMPLATE_CHANNELS.filter((channel) => channel === 'E_RECEIPT' || channelAllowed(has, channel))
  const [creating, setCreating] = useState<TemplateChannel | null>(null)

  return (
    // the shell's <main> already gives the page its white ground and padding
    <div className="flex flex-col gap-8">
      <section className="rounded-lg bg-band px-[clamp(20px,2vw,32px)] pt-7 pb-8">
        <span className="flex items-center gap-1.5"><h1 className="font-display text-page-title font-semibold text-on-brand">Templates</h1><PageHelp chapter="templates" onBrand /></span>
        <p className="mt-1 text-sm leading-normal text-on-brand-soft">Start a new message from a channel, or pick up a template from your library below.</p>
        {canEdit && channels.length > 0 && <QuickCreateCards channels={channels} onPick={setCreating} />}
      </section>

      <TemplateLibrary channels={channels} canEdit={canEdit} />

      {creating && <CreateTemplateModal channel={creating} onClose={() => setCreating(null)} />}
    </div>
  )
}
