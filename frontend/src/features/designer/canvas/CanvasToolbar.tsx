/**
 * The row across the top of the canvas: one centred group of every tool. Knows nothing about GrapesJS: every
 * button reports what was pressed and shows what it is told.
 *
 * When the row is narrower than the group, the rarest tools fold into a More menu. That is decided by measuring
 * a hidden copy of every item against the row, never by guessing widths, and the group stays centred throughout.
 */
import {
  Check, ChevronDown, Code, Download, Ellipsis, Eye, Maximize2, Minus, Monitor, Plus, Redo2, Smartphone, SquareDashed, Tablet, Undo2, type LucideIcon,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { useSingleDropdown } from '@/lib/useSingleDropdown'

import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS, formatZoom, type ZoomMode } from '../zoom/zoom'
import { COMPACT_TIER, FOLDED, TIERS, chooseTier, type ToolId } from './overflow'
import { EXIT_FULLSCREEN_LABEL, FIT_LABEL, MORE_LABEL, OUTLINES_LABEL, TOOL_LABELS, ZOOM_MENU_LABEL } from './toolbarLabels'


export interface CanvasToolbarProps {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  zoom: number
  zoomMode: ZoomMode
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomSelect: (value: 'fit' | number) => void
  devices: readonly { id: string; label: string }[]
  device: string
  onDeviceChange: (id: string) => void
  outlines: boolean
  onOutlinesChange: (next: boolean) => void
  onPreview: () => void
  onFullscreen: () => void
  /** true while the side panels are folded away for the canvas */
  fullscreen?: boolean
  onViewCode: () => void
  onDownload: () => void
  /** read-only: history is off; everything else is a view, and stays on */
  disabled?: boolean
}

const DEVICE_ICONS: Record<string, LucideIcon> = { Desktop: Monitor, Tablet, 'Mobile portrait': Smartphone }
const DEVICE_IDS: Record<string, ToolId> = { Desktop: 'desktop', Tablet: 'tablet', 'Mobile portrait': 'mobile' }
const FOLDED_ICONS: Record<string, LucideIcon> = { outlines: SquareDashed, preview: Eye, fullscreen: Maximize2, code: Code, download: Download }

const BUTTON = 'inline-flex h-8 shrink-0 items-center justify-center rounded-sm border text-sm whitespace-nowrap transition-colors duration-base ease-standard'
const ENABLED = 'border-line bg-surface text-ink-700 hover:bg-line-subtle'
const DISABLED = 'border-line bg-line-subtle text-ink-300'
const PRESSED = 'border-brand-600 bg-brand-100 text-brand-800'
const MENU = 'absolute top-full z-50 mt-1 rounded-lg border border-line bg-surface py-1 shadow-menu'
const ITEM = 'flex h-8 w-full items-center gap-2 px-3 text-left text-sm text-ink-900 transition-colors duration-base ease-standard hover:bg-line-subtle'

function IconButton({ id, label, icon: Icon, onClick, disabled = false, pressed }: { id: ToolId; label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      data-tool={id}
      aria-label={label}
      title={label}
      aria-disabled={disabled || undefined}
      aria-pressed={pressed}
      onClick={disabled ? undefined : onClick}
      className={`${BUTTON} w-8 ${disabled ? DISABLED : pressed ? PRESSED : ENABLED}`}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden />
    </button>
  )
}

/** -mx-1 takes the group's 8px gap down to 4px either side of the divider, and only there. */
function Divider({ compact }: { compact: boolean }) {
  return <span aria-hidden data-tool="|" className={`h-5 w-px shrink-0 bg-line ${compact ? '-mx-1' : ''}`} />
}

export function CanvasToolbar(props: CanvasToolbarProps) {
  const { zoom, zoomMode } = props
  const row = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const [tier, setTier] = useState(0)

  // Every item is rendered once more, invisibly, so the group's needs are measured rather than guessed. Re-measured
  // whenever the row changes size and whenever the zoom label — the one item whose width varies — changes.
  useLayoutEffect(() => {
    const measure = () => {
      if (!row.current || !probe.current) return
      const widths = TIERS.map((_, index) => probe.current?.querySelector<HTMLElement>(`[data-tier="${index}"]`)?.offsetWidth ?? 0)
      setTier(chooseTier(row.current.clientWidth, widths))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(row.current as Element)
    return () => observer.disconnect()
  }, [zoom, zoomMode])

  return (
    <div
      ref={row}
      role="toolbar"
      aria-label="Canvas"
      className={`relative flex h-14 shrink-0 items-center justify-center border-b border-line bg-surface ${tier === COMPACT_TIER ? 'px-2' : 'px-3'}`}
    >
      <Tools {...props} tier={tier} />
      <div ref={probe} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex flex-col">
        {TIERS.map((_, index) => (
          <div key={index} data-tier={index} className="w-max">
            <Tools {...props} tier={index} probe />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The group at one tier. `probe` renders every item including More, for measuring, and never opens anything. */
function Tools({
  canUndo, canRedo, onUndo, onRedo, zoom, zoomMode, onZoomIn, onZoomOut, onZoomSelect, devices, device, onDeviceChange,
  outlines, onOutlinesChange, onPreview, onFullscreen, fullscreen = false, onViewCode, onDownload, disabled = false, tier, probe = false,
}: CanvasToolbarProps & { tier: number; probe?: boolean }) {
  const menus = useSingleDropdown<'zoom' | 'more'>()
  const zoomTrigger = menus.triggerProps('zoom')
  const moreTrigger = menus.triggerProps('more')
  const chooseZoom = (value: 'fit' | number) => {
    menus.close()
    onZoomSelect(value)
  }
  const fromMenu = (action: () => void) => () => {
    menus.close()
    action()
  }

  const actions: Record<string, { label: string; onClick: () => void; pressed?: boolean }> = {
    outlines: { label: OUTLINES_LABEL, onClick: () => onOutlinesChange(!outlines), pressed: outlines },
    preview: { label: TOOL_LABELS.preview, onClick: onPreview },
    fullscreen: { label: fullscreen ? EXIT_FULLSCREEN_LABEL : TOOL_LABELS.fullscreen, onClick: onFullscreen, pressed: fullscreen },
    code: { label: TOOL_LABELS.code, onClick: onViewCode },
    download: { label: TOOL_LABELS.download, onClick: onDownload },
  }
  const items = TIERS[tier]
  const folded = FOLDED[tier]
  const compact = tier === COMPACT_TIER

  const render = (item: ToolId | '|', index: number): ReactNode => {
    switch (item) {
      case '|':
        return <Divider key={index} compact={compact} />
      case 'undo':
        return <IconButton key={item} id={item} label={TOOL_LABELS.undo} icon={Undo2} onClick={onUndo} disabled={disabled || !canUndo} />
      case 'redo':
        return <IconButton key={item} id={item} label={TOOL_LABELS.redo} icon={Redo2} onClick={onRedo} disabled={disabled || !canRedo} />
      case 'zoomOut':
        return <IconButton key={item} id={item} label={TOOL_LABELS.zoomOut} icon={Minus} onClick={onZoomOut} disabled={zoom <= ZOOM_MIN} />
      case 'zoomIn':
        return <IconButton key={item} id={item} label={TOOL_LABELS.zoomIn} icon={Plus} onClick={onZoomIn} disabled={zoom >= ZOOM_MAX} />
      case 'zoom':
        return (
          <div key={item} className="relative">
            <button
              {...(probe ? {} : zoomTrigger)}
              type="button"
              data-tool="zoom"
              aria-label={ZOOM_MENU_LABEL}
              title={ZOOM_MENU_LABEL}
              className={`${BUTTON} ${ENABLED} cep-num gap-1 px-2.5`}
            >
              {formatZoom(zoom, zoomMode, compact)}
              <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
            </button>
            {!probe && menus.isOpen('zoom') ?
              <div {...menus.panelProps('zoom')} role="region" aria-label={ZOOM_MENU_LABEL} className={`${MENU} left-0 w-44`}>
                <MenuItem label={FIT_LABEL} current={zoomMode === 'fit'} onClick={() => chooseZoom('fit')} numeric={false} />
                {ZOOM_STEPS.map((step) => (
                  <MenuItem key={step} label={`${step}%`} current={zoomMode === 'manual' && zoom === step} onClick={() => chooseZoom(step)} />
                ))}
              </div>
            : null}
          </div>
        )
      case 'desktop':
      case 'tablet':
      case 'mobile': {
        const entry = devices.find((candidate) => DEVICE_IDS[candidate.id] === item)
        if (!entry) return null
        const Icon = DEVICE_ICONS[entry.id] ?? Monitor
        const selected = entry.id === device
        const position = item === 'desktop' ? 'rounded-r-none' : item === 'mobile' ? '-ml-px rounded-l-none' : '-ml-px rounded-none'
        return (
          <button
            key={item}
            type="button"
            role="radio"
            data-tool={item}
            aria-checked={selected}
            aria-label={entry.label}
            title={entry.label}
            onClick={() => onDeviceChange(entry.id)}
            className={`${BUTTON} w-8 ${position} ${selected ? `${PRESSED} relative z-10` : ENABLED}`}
          >
            <Icon size={16} strokeWidth={1.5} aria-hidden />
          </button>
        )
      }
      case 'more':
        return (
          <div key={item} className="relative">
            <button
              {...(probe ? {} : moreTrigger)}
              type="button"
              data-tool="more"
              aria-label={MORE_LABEL}
              title={MORE_LABEL}
              className={`${BUTTON} w-8 ${ENABLED}`}
            >
              <Ellipsis size={16} strokeWidth={1.5} aria-hidden />
            </button>
            {!probe && menus.isOpen('more') ?
              <div {...menus.panelProps('more')} role="region" aria-label={MORE_LABEL} className={`${MENU} right-0 w-52`}>
                {folded.map((id) => {
                  const action = actions[id]
                  const Icon = FOLDED_ICONS[id]
                  return (
                    <button key={id} type="button" data-dropdown-item aria-pressed={action.pressed} onClick={fromMenu(action.onClick)} className={ITEM}>
                      <Icon size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-ink-700" />
                      <span className="flex-1">{action.label}</span>
                      {action.pressed ? <Check size={16} strokeWidth={1.5} aria-hidden className="text-brand-800" /> : null}
                    </button>
                  )
                })}
              </div>
            : null}
          </div>
        )
      default: {
        const action = actions[item]
        return <IconButton key={item} id={item} label={action.label} icon={FOLDED_ICONS[item]} onClick={action.onClick} pressed={action.pressed} />
      }
    }
  }

  // the devices sit flush as one segmented control, so their gaps are removed by wrapping them together
  const nodes: ReactNode[] = []
  let segment: ReactNode[] = []
  items.forEach((item, index) => {
    if (item === 'desktop' || item === 'tablet' || item === 'mobile') {
      segment.push(render(item, index))
      return
    }
    if (segment.length > 0) {
      nodes.push(<div key={`devices-${index}`} role="radiogroup" aria-label="Device" className="flex">{segment}</div>)
      segment = []
    }
    nodes.push(render(item, index))
  })
  if (segment.length > 0) nodes.push(<div key="devices-end" role="radiogroup" aria-label="Device" className="flex">{segment}</div>)

  return <div data-tools-group={probe ? undefined : ''} className="flex items-center gap-2">{nodes}</div>
}

function MenuItem({ label, current, onClick, numeric = true }: { label: string; current: boolean; onClick: () => void; numeric?: boolean }) {
  return (
    <button type="button" data-dropdown-item aria-current={current || undefined} onClick={onClick} className={`${ITEM} justify-between`}>
      <span className={numeric ? 'cep-num' : ''}>{label}</span>
      {current ? <Check size={16} strokeWidth={1.5} aria-hidden className="text-brand-800" /> : null}
    </button>
  )
}
