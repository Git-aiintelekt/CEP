/** The block palette beside the canvas. Knows nothing about GrapesJS: dragging and inserting are the caller's. */
import {
  AlignCenter,
  Code,
  Columns2,
  Columns3,
  Columns4,
  Heading,
  Image,
  Megaphone,
  Minus,
  Info,
  MousePointerClick,
  MoveVertical,
  PanelTop,
  RectangleHorizontal,
  Share2,
  ShoppingBag,
  Square,
  Ticket,
  Type,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { Notice } from '@/components/Notice'

import { BLOCK_CATEGORIES } from './blocks/registry'
import type { CepBlock } from './blocks/types'
import { PanelSearch } from './ui/PanelSearch'
import { Tile } from './ui/Tile'

/** Named one by one: importing the whole icon set would pull every glyph into the bundle. */
const ICONS: Record<string, LucideIcon> = {
  AlignCenter,
  Code,
  Columns2,
  Columns3,
  Columns4,
  Heading,
  Image,
  Megaphone,
  Minus,
  MousePointerClick,
  MoveVertical,
  PanelTop,
  RectangleHorizontal,
  Share2,
  ShoppingBag,
  Ticket,
  Type,
}

export const FALLBACK_ICON = Square

export const NO_MATCH_NOTE = 'No blocks match'

interface BlockPaletteProps {
  blocks: CepBlock[]
  disabled?: boolean
  message?: string | null
  onDragStart: (blockId: string, event: ReactPointerEvent) => void
  onInsert: (blockId: string) => void
  /** one grid of three, without category headings: a palette small enough to take in at a glance */
  flat?: boolean
}

export function BlockPalette({ blocks, disabled = false, message, onDragStart, onInsert, flat = false }: BlockPaletteProps) {
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const term = query.trim().toLowerCase()
    const labelOf = new Map(BLOCK_CATEGORIES.map((category) => [category.id, category.label]))
    const matches = (block: CepBlock) =>
      term === '' || block.label.toLowerCase().includes(term) || (labelOf.get(block.category) ?? '').toLowerCase().includes(term)

    return BLOCK_CATEGORIES.map((category) => ({ ...category, blocks: blocks.filter((block) => block.category === category.id && matches(block)) })).filter(
      (category) => category.blocks.length > 0,
    )
  }, [blocks, query])

  return (
    <aside aria-label="Blocks" className="flex h-full min-h-0 w-full flex-col bg-surface">
      {/* pinned: the search stays put while the grid below it scrolls */}
      <PanelSearch label="Search blocks" value={query} placeholder="Search blocks" onChange={setQuery} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ?
          <p className="px-3 py-1.5 text-[11px] text-ink-300">{NO_MATCH_NOTE}</p>
        : flat ?
          <div className="grid grid-cols-3 gap-1 p-2">
            {/* in the palette's own order, not by category */}
            {blocks
              .filter((block) => groups.some((category) => category.blocks.includes(block)))
              .map((block) => (
                <PaletteTile key={block.id} block={block} disabled={disabled} onDragStart={onDragStart} onInsert={onInsert} />
              ))}
          </div>
        : groups.map((category) => (
            <section key={category.id}>
              <h3 className="px-2 py-1.5 text-xs text-ink-300">{category.label}</h3>
              <div className="grid grid-cols-2 gap-1 px-2 pb-2">
                {category.blocks.map((block) => (
                  <PaletteTile key={block.id} block={block} disabled={disabled} onDragStart={onDragStart} onInsert={onInsert} />
                ))}
              </div>
            </section>
          ))
        }
        {/* aria-hidden: the live region below is the one a reader hears, so the note is not announced twice */}
        {message && (
          <div aria-hidden>
            <Notice layout="panel" icon={Info} iconClass="text-ink-700" textClass="text-ink-700">
              {message}
            </Notice>
          </div>
        )}
      </div>

      {/* the live region outlives any one message, so a reader hears the next one too */}
      <span role="status" aria-live="polite" className="sr-only">
        {message ?? ''}
      </span>
    </aside>
  )
}

function PaletteTile({
  block,
  disabled,
  onDragStart,
  onInsert,
}: {
  block: CepBlock
  disabled: boolean
  onDragStart: BlockPaletteProps['onDragStart']
  onInsert: BlockPaletteProps['onInsert']
}) {
  const Icon = ICONS[block.icon] ?? FALLBACK_ICON

  return (
    <Tile
      label={block.label}
      icon={Icon}
      grab={!disabled}
      softDisabled={disabled}
      title={block.label}
      className="[touch-action:none]"
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return
        onDragStart(block.id, event)
      }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault() // Space would scroll the palette
        onInsert(block.id)
      }}
      onClick={(event) => {
        // detail 0 is a click the keyboard raised; a real pointer click already began a drag
        if (disabled || event.detail !== 0) return
        onInsert(block.id)
      }}
    />
  )
}
