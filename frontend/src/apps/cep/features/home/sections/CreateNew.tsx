import { FileText, GitBranch, Plus, Users, type LucideIcon } from 'lucide-react'
import { useId, useState } from 'react'

import { buttonClass } from '@/components/buttonStyles'

import { CampaignSetupDialog } from '@/apps/cep/features/campaigns/setup/CampaignSetupDialog'
import { CreateListWizard } from '@/apps/cep/features/contact-lists/CreateListWizard'
import { JourneySetupModal } from '@/apps/cep/features/journeys/JourneySetupModal'
import { prefillNamed, type SetupPrefill } from '@/apps/cep/features/journeys/templates/prefill'
import { CreateTemplateModal } from '@/apps/cep/features/templates/CreateTemplateModal'

import type { CreateTile } from '../createNewTiles'

/** the design's order: the shortcuts outlined in blue, then Create Campaign as the page's one primary action */
const ORDER: CreateTile['key'][] = ['journey', 'template', 'list', 'campaign']
/** each shortcut wears its page's rail icon; Create Campaign keeps the plus */
const ICON: Record<CreateTile['key'], LucideIcon> = { journey: GitBranch, template: FileText, list: Users, campaign: Plus }

/**
 * The create shortcuts as buttons beside the greeting: the shortcuts outlined, Create Campaign filled. Each opens its
 * create pop-up right here on Home, never another page; the caller hides the section when there are none.
 */
export function CreateNew({ tiles }: { tiles: CreateTile[] }) {
  const titleId = useId()
  const [open, setOpen] = useState<CreateTile['key'] | null>(null)
  /** Create a Journey Instead, from the Create Campaign pop-up: the journey pop-up opens with its name and description */
  const [journeyFrom, setJourneyFrom] = useState<SetupPrefill | undefined>(undefined)
  const close = () => { setOpen(null); setJourneyFrom(undefined) }
  const shown = ORDER.map((key) => tiles.find((tile) => tile.key === key)).filter((tile): tile is CreateTile => Boolean(tile))
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-wrap items-center gap-2">
      <h2 id={titleId} className="sr-only">Create New</h2>
      {shown.map(({ key, label }) => {
        const Icon = ICON[key]
        return (
        <button key={key} type="button" data-create={key} aria-haspopup="dialog" className={buttonClass({ variant: key === 'campaign' ? 'primary' : 'secondary' })} onClick={() => setOpen(key)}>
          <Icon size={16} strokeWidth={key === 'campaign' ? 2 : 1.5} aria-hidden />
          {key === 'campaign' ? 'Create Campaign' : label}
        </button>
        )
      })}
      {open === 'campaign' && (
        <CampaignSetupDialog onClose={close} onCreateJourney={({ name, description }) => { setJourneyFrom(prefillNamed(name, description)); setOpen('journey') }} />
      )}
      {open === 'list' && <CreateListWizard onClose={close} />}
      {open === 'template' && <CreateTemplateModal onClose={close} />}
      {open === 'journey' && <JourneySetupModal prefill={journeyFrom} onClose={close} />}
    </section>
  )
}
