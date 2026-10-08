import { Plus } from 'lucide-react'
import { useId, useState } from 'react'

import { buttonClass } from '@/components/buttonStyles'

import { CampaignSetupDialog } from '@/features/campaigns/setup/CampaignSetupDialog'
import { CreateListWizard } from '@/features/contact-lists/CreateListWizard'
import { JourneySetupModal } from '@/features/journeys/JourneySetupModal'
import { prefillNamed, type SetupPrefill } from '@/features/journeys/templates/prefill'
import { CreateTemplateModal } from '@/features/templates/CreateTemplateModal'

import type { CreateTile } from '../createNewTiles'

/** the design's order: the shortcuts, then Create Campaign as the page's one primary action */
const ORDER: CreateTile['key'][] = ['list', 'template', 'journey', 'campaign']
/** Home's neutral outline (the design's): a grey control border and dark text, so blue stays on Create Campaign */
const NEUTRAL = 'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-control-lg border border-line-control bg-surface px-4 text-sm font-semibold whitespace-nowrap text-ink-900 transition-colors duration-fast ease-standard hover:bg-surface-hover active:bg-fill-subtle'

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
      {shown.map(({ key, label }) => (
        <button key={key} type="button" data-create={key} aria-haspopup="dialog" className={key === 'campaign' ? buttonClass({ variant: 'primary' }) : NEUTRAL} onClick={() => setOpen(key)}>
          <Plus size={16} strokeWidth={2} aria-hidden />
          {key === 'campaign' ? 'Create Campaign' : label}
        </button>
      ))}
      {open === 'campaign' && (
        <CampaignSetupDialog onClose={close} onCreateJourney={({ name, description }) => { setJourneyFrom(prefillNamed(name, description)); setOpen('journey') }} />
      )}
      {open === 'list' && <CreateListWizard onClose={close} />}
      {open === 'template' && <CreateTemplateModal onClose={close} />}
      {open === 'journey' && <JourneySetupModal prefill={journeyFrom} onClose={close} />}
    </section>
  )
}
