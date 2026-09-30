/** The library grid, shared by the Assets tab and the picker dialog. Knows nothing about GrapesJS. */
import { ImageOff } from 'lucide-react'
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { DesignerAsset } from '../EmailDesigner'

export const EMPTY_NOTE = 'No images yet. Upload one to get started.'

const TILE_BASE = 'flex w-full flex-col gap-1 rounded-sm p-1 text-left'
const TILE = `${TILE_BASE} transition-colors hover:bg-fill-subtle`
const TILE_DISABLED = `${TILE_BASE} bg-fill-subtle`
const THUMB = 'aspect-square w-full rounded-lg border border-line bg-surface-subtle object-contain'
const CAPTION = 'truncate text-xs'
/** How far the pointer travels before a press counts as carrying the image rather than choosing it. */
const DRAG_THRESHOLD = 5

interface AssetGridProps {
  assets: DesignerAsset[]
  /** file names still going up, shown as placeholders in the grid */
  uploading?: string[]
  disabled?: boolean
  onUse: (asset: DesignerAsset) => void
  /** offered only where a drop target exists: in the dialog an image is chosen, not carried */
  onDragStart?: (asset: DesignerAsset, event: ReactPointerEvent) => void
  /** two in the narrow rail, four in the dialog */
  columns?: 2 | 4
}

export function AssetGrid({ assets, uploading = [], disabled = false, onUse, onDragStart, columns = 2 }: AssetGridProps) {
  if (assets.length === 0 && uploading.length === 0) return <p className="text-sm text-ink-800">{EMPTY_NOTE}</p>

  return (
    <div className={`grid gap-2 ${columns === 4 ? 'grid-cols-4' : 'grid-cols-2'}`}>
      {assets.map((asset) => (
        <Tile key={asset.url} asset={asset} disabled={disabled} onUse={onUse} onDragStart={onDragStart} />
      ))}
      {uploading.map((name) => (
        <Placeholder key={`uploading:${name}`} name={name} />
      ))}
    </div>
  )
}

function Tile({ asset, disabled, onUse, onDragStart }: { asset: DesignerAsset; disabled: boolean } & Pick<AssetGridProps, 'onUse' | 'onDragStart'>) {
  const [broken, setBroken] = useState(false)
  const pressedAt = useRef<{ x: number; y: number } | null>(null)
  const carried = useRef(false)

  return (
    <button
      type="button"
      // aria-disabled, not disabled: a reader still needs to find the image and hear that it is inert
      aria-disabled={disabled || undefined}
      className={`${disabled ? TILE_DISABLED : TILE} ${onDragStart && !disabled ? '[touch-action:none]' : ''}`}
      title={onDragStart && !disabled ? `${asset.name} — drag onto the email, or click to use it` : asset.name}
      onPointerDown={(event) => {
        carried.current = false
        if (disabled || event.button !== 0 || !onDragStart) return
        pressedAt.current = { x: event.clientX, y: event.clientY }
        // the pointer leaves the tile almost at once, and the moves have to keep arriving to start the drag
        capture(event.currentTarget, event.pointerId, true)
      }}
      // A press that never moves is a click, which applies the image; only a press that travels carries it.
      onPointerMove={(event) => {
        const from = pressedAt.current
        if (!from || Math.abs(event.clientX - from.x) + Math.abs(event.clientY - from.y) < DRAG_THRESHOLD) return
        pressedAt.current = null
        carried.current = true
        capture(event.currentTarget, event.pointerId, false)
        onDragStart?.(asset, event)
      }}
      onPointerUp={() => {
        pressedAt.current = null
      }}
      onClick={() => {
        if (disabled || carried.current) return
        onUse(asset)
      }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onUse(asset)
      }}
    >
      {broken ?
        <span className={`${THUMB} flex items-center justify-center`} aria-hidden>
          <ImageOff size={20} strokeWidth={1.5} className="text-ink-300" />
        </span>
        // alt is empty because the file name below is already the tile's accessible name
      : <img src={asset.url} alt="" loading="lazy" draggable={false} className={THUMB} onError={() => setBroken(true)} />}
      <span className={`${CAPTION} ${disabled ? 'text-ink-300' : 'text-ink-800'}`} title={asset.name}>
        {asset.name}
      </span>
    </button>
  )
}

/** Pointer capture is absent in jsdom, and a browser refuses it for a pointer that is already gone. */
function capture(element: HTMLElement, pointerId: number, on: boolean): void {
  try {
    if (on) element.setPointerCapture?.(pointerId)
    else element.releasePointerCapture?.(pointerId)
  } catch {
    // the drag works without it; only moves outside the tile would be missed
  }
}

function Placeholder({ name }: { name: string }) {
  return (
    <div className={TILE_BASE}>
      <span className={`${THUMB} flex items-center justify-center`}>
        <span className="h-4 w-4 animate-spin rounded-pill border-2 border-line border-t-brand-600" aria-hidden />
      </span>
      <span className={`${CAPTION} text-ink-800`} title={name}>
        {name}
      </span>
    </div>
  )
}
