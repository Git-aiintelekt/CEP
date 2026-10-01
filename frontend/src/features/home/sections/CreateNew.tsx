import { useId } from 'react'
import { Link } from 'react-router-dom'

import type { CreateTile } from '../createNewTiles'

const BUTTON = 'inline-flex h-10 items-center gap-2 rounded-control-lg border border-line-control bg-surface pr-3.5 pl-2.5 text-sm font-medium whitespace-nowrap text-ink-900 transition-colors duration-fast ease-standard hover:bg-surface-subtle active:bg-fill-subtle'

/** The create shortcuts as a row of buttons beside the greeting, each with its plum icon; the caller hides the section when there are none. */
export function CreateNew({ tiles }: { tiles: CreateTile[] }) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-wrap items-center gap-2">
      <h2 id={titleId} className="mr-1 text-helper font-normal text-ink-800">Create New</h2>
      {tiles.map(({ key, label, icon: Icon, to }) => (
        <Link key={key} to={to} data-create={key} className={BUTTON}>
          <span aria-hidden data-plum-icon className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control-sm bg-plum-100 text-plum-700"><Icon size={14} strokeWidth={1.5} /></span>
          {label}
        </Link>
      ))}
    </section>
  )
}
