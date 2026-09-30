import { ChevronRight, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'

import { HomeCard } from '../components/HomeCard'
import type { CreateTile } from '../createNewTiles'

const WIDE_COLUMNS = ['', 'min-[768px]:grid-cols-1', 'min-[768px]:grid-cols-2', 'min-[768px]:grid-cols-3', 'min-[768px]:grid-cols-4']
// 1px dividers between tiles wherever they fall: one row from 768px, two per row from 480px, one per row below
const DIVIDERS = 'border-line-subtle max-[479px]:[&:not(:first-child)]:border-t min-[480px]:max-[767px]:[&:nth-child(even)]:border-l min-[480px]:max-[767px]:[&:nth-child(n+3)]:border-t min-[768px]:[&:not(:first-child)]:border-l'

/** One row of create shortcuts, each a whole-tile link; the caller hides the section when there are none. */
export function CreateNew({ tiles }: { tiles: CreateTile[] }) {
  return (
    <HomeCard title="Create New" icon={Plus} flush>
      <ul className={`grid grid-cols-1 ${tiles.length > 1 ? 'min-[480px]:grid-cols-2' : ''} ${WIDE_COLUMNS[tiles.length]}`}>
        {tiles.map(({ key, label, icon: Icon, to }) => (
          <li key={key} className={`min-w-0 ${DIVIDERS}`}>
            <Link to={to} data-create={key} className="flex h-16 items-center gap-3 px-4 transition-colors duration-fast ease-standard hover:bg-surface-subtle">
              <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control-md bg-plum-100 text-plum-700"><Icon size={16} strokeWidth={1.5} /></span>
              <span className="min-w-0 truncate text-card-title font-semibold text-ink-900">{label}</span>
              <ChevronRight size={16} strokeWidth={1.5} aria-hidden className="ml-auto shrink-0 text-ink-800" />
            </Link>
          </li>
        ))}
      </ul>
    </HomeCard>
  )
}
