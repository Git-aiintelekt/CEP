import { Plus } from 'lucide-react'
import { useId } from 'react'
import { Link } from 'react-router-dom'

import { buttonClass } from '@/components/buttonStyles'

import type { CreateTile } from '../createNewTiles'

/** the design's order: the two secondary shortcuts, then Create Campaign as the page's one primary action */
const ORDER: CreateTile['key'][] = ['list', 'template', 'campaign']

/** The create shortcuts as buttons beside the greeting: Contact List and Template outlined, Create Campaign filled; the caller hides the section when there are none. */
export function CreateNew({ tiles }: { tiles: CreateTile[] }) {
  const titleId = useId()
  const shown = ORDER.map((key) => tiles.find((tile) => tile.key === key)).filter((tile): tile is CreateTile => Boolean(tile))
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-wrap items-center gap-2">
      <h2 id={titleId} className="sr-only">Create New</h2>
      {shown.map(({ key, label, to }) => (
        <Link key={key} to={to} data-create={key} className={buttonClass({ variant: key === 'campaign' ? 'primary' : 'secondary' })}>
          <Plus size={16} strokeWidth={2} aria-hidden />
          {key === 'campaign' ? 'Create Campaign' : label}
        </Link>
      ))}
    </section>
  )
}
