/**
 * The colour popover.
 *
 * A drag has to cost one undo step, so every intermediate value goes out through onPreview and only the last
 * through onCommit — on pointer release, or when a control the arrow keys were moving loses focus.
 *
 * The saturation square and the hue strip are gradients of the colour being chosen. They are the picture of the
 * data, not UI chrome, so they are inline styles rather than tokens; everything around them is tokens.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

import type { PanelProps } from '@/lib/useSingleDropdown'

import { clamp, hexToHsv, hsvToHex, normaliseHex } from './colorMath'
import { SWATCH_GROUPS, nameForHex } from './palette'

export const NO_COLOR_LABEL = 'No Colour'
export const RECENT_LABEL = 'Recent'
export const AREA_LABEL = 'Saturation and Brightness'
export const HUE_LABEL = 'Hue'
export const HEX_LABEL = 'Hex Colour'
export const HEX_ERROR = 'Use a six-digit hex colour'
export const RECENT_LIMIT = 8

const AREA_HEIGHT = 120

interface ColorPickerProps {
  value: string | null
  recent?: string[]
  onPreview?: (hex: string) => void
  onCommit: (hex: string | null) => void
  onCancel?: () => void
  onRecentUse?: (hex: string) => void
  /** true when there is no room below the field and the panel has to sit above it */
  flip?: boolean
  panelProps: PanelProps
}

export function ColorPicker({ value, recent = [], onPreview, onCommit, onCancel, onRecentUse, flip = false, panelProps }: ColorPickerProps) {
  const start = hexToHsv(value ?? '') ?? { h: 0, s: 0, v: 100 }
  const [hsv, setHsv] = useState(start)
  const [hex, setHex] = useState(value ?? '')
  const [hexError, setHexError] = useState<string | null>(null)
  const firstSwatch = useRef<HTMLButtonElement>(null)
  // set by an arrow key, cleared by the commit that follows when the control loses focus
  const pending = useRef(false)

  useEffect(() => {
    firstSwatch.current?.focus()
  }, [])

  const show = (next: { h: number; s: number; v: number }) => {
    setHsv(next)
    const written = hsvToHex(next.h, next.s, next.v)
    setHex(written)
    setHexError(null)
    onPreview?.(written)
  }

  const settle = (next: { h: number; s: number; v: number }) => {
    const written = hsvToHex(next.h, next.s, next.v)
    pending.current = false
    onCommit(written)
    onRecentUse?.(written)
  }

  const choose = (picked: string) => {
    const written = normaliseHex(picked)
    if (written === null) return
    setHsv(hexToHsv(written) ?? hsv)
    setHex(written)
    setHexError(null)
    onCommit(written)
    onRecentUse?.(written)
  }

  /** Where in the square the pointer is, as saturation and brightness. */
  const fromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return {
      h: hsv.h,
      s: Math.round(clamp(((event.clientX - box.left) / box.width) * 100, 0, 100)),
      v: Math.round(clamp((1 - (event.clientY - box.top) / box.height) * 100, 0, 100)),
    }
  }

  const areaDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    show(fromPointer(event))
  }
  const areaMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    show(fromPointer(event))
  }
  const areaUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    settle(fromPointer(event))
  }

  const areaKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1
    const moves: Record<string, { s: number; v: number }> = {
      ArrowLeft: { s: -step, v: 0 }, ArrowRight: { s: step, v: 0 },
      ArrowUp: { s: 0, v: step }, ArrowDown: { s: 0, v: -step },
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    event.stopPropagation() // the panel would otherwise move focus between rows
    pending.current = true
    show({ h: hsv.h, s: clamp(hsv.s + move.s, 0, 100), v: clamp(hsv.v + move.v, 0, 100) })
  }

  const hueFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return { ...hsv, h: Math.round(clamp(((event.clientX - box.left) / box.width) * 360, 0, 360)) }
  }

  const hueKeys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -step : 0
    if (delta === 0) return
    event.preventDefault()
    event.stopPropagation()
    pending.current = true
    show({ ...hsv, h: clamp(hsv.h + delta, 0, 360) })
  }

  const blurCommit = () => {
    if (pending.current) settle(hsv)
  }

  const commitHex = () => {
    const written = normaliseHex(hex)
    if (written === null) {
      setHexError(HEX_ERROR)
      return
    }
    setHexError(null)
    setHsv(hexToHsv(written) ?? hsv)
    onCommit(written)
    onRecentUse?.(written)
  }

  const pure = hsvToHex(hsv.h, 100, 100)
  const current = hsvToHex(hsv.h, hsv.s, hsv.v)

  return (
    <div
      {...panelProps}
      role="region"
      aria-label="Colour Picker"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          // closing takes focus back to the swatch, which blurs whatever was being arrowed: that blur must
          // not then commit the value Escape just abandoned
          pending.current = false
          onCancel?.()
        }
        panelProps.onKeyDown(event)
      }}
      className={`absolute right-0 z-20 w-[248px] overflow-hidden rounded-lg border border-line bg-surface p-3 shadow-menu ${flip ? 'bottom-full mb-1' : 'top-full mt-1'}`}
    >
      {SWATCH_GROUPS.map((group, groupIndex) => (
        <div key={group.id} className={groupIndex === 0 ? '' : 'mt-2'}>
          <p className="mb-1 text-xs text-ink-500">{group.label}</p>
          <div className="grid grid-cols-8 gap-1">
            {group.swatches.map((swatch, index) => (
              <button
                key={swatch.hex}
                ref={groupIndex === 0 && index === 0 ? firstSwatch : undefined}
                type="button"
                title={swatch.name}
                aria-label={swatch.name}
                aria-pressed={normaliseHex(value ?? '') === swatch.hex.toLowerCase()}
                onClick={() => choose(swatch.hex)}
                style={{ backgroundColor: swatch.hex }}
                className={`h-6 w-6 rounded-sm border transition-colors duration-base ease-standard ${
                  normaliseHex(value ?? '') === swatch.hex.toLowerCase() ? 'border-brand-600' : 'border-line hover:border-ink-300'
                }`}
              />
            ))}
          </div>
        </div>
      ))}

      {/* -mx-3 takes the square out to the panel edges, where a colour field belongs */}
      <div
        role="slider"
        tabIndex={0}
        aria-label={AREA_LABEL}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={hsv.s}
        aria-valuetext={`Saturation ${hsv.s}%, brightness ${hsv.v}%`}
        onPointerDown={areaDown}
        onPointerMove={areaMove}
        onPointerUp={areaUp}
        onKeyDown={areaKeys}
        onBlur={blurCommit}
        style={{ height: AREA_HEIGHT, backgroundColor: pure, touchAction: 'none' }}
        className="relative -mx-3 mt-3 cursor-crosshair"
      >
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to right, #ffffff, rgba(255,255,255,0))' }} />
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #000000, rgba(0,0,0,0))' }} />
        <span
          aria-hidden
          style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, backgroundColor: current }}
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-pill border border-line ring-2 ring-white"
        />
      </div>

      <div
        role="slider"
        tabIndex={0}
        aria-label={HUE_LABEL}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={hsv.h}
        aria-valuetext={`${hsv.h} degrees`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          show(hueFromPointer(event))
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) show(hueFromPointer(event))
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          event.currentTarget.releasePointerCapture(event.pointerId)
          settle(hueFromPointer(event))
        }}
        onKeyDown={hueKeys}
        onBlur={blurCommit}
        style={{
          background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
          touchAction: 'none',
        }}
        className="relative mt-3 h-2 rounded-pill"
      >
        <span
          aria-hidden
          style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: pure }}
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-pill border border-line ring-2 ring-white"
        />
      </div>

      <div className="mt-3 flex items-center gap-1">
        <input
          type="text"
          autoComplete="off"
          aria-label={HEX_LABEL}
          aria-invalid={hexError !== null || undefined}
          value={hex}
          onChange={(event) => {
            setHex(event.target.value)
            if (hexError !== null) setHexError(null)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            commitHex()
          }}
          onBlur={commitHex}
          className={`cep-num h-8 min-w-0 flex-1 rounded-sm border px-2 text-sm text-ink-900 transition-colors duration-base ease-standard focus-visible:border-brand-600 ${hexError === null ? 'border-line' : 'border-danger'}`}
        />
        <button
          type="button"
          onClick={() => onCommit(null)}
          className="inline-flex h-8 shrink-0 items-center rounded-sm px-2 text-xs font-medium text-brand-800 transition-colors duration-base ease-standard hover:bg-line-subtle"
        >
          {NO_COLOR_LABEL}
        </button>
      </div>
      {hexError !== null ?
        <p className="mt-1 text-xs font-medium text-danger-text">{hexError}</p>
      : null}

      {recent.length > 0 ?
        <div className="mt-3">
          <p className="mb-1 text-xs text-ink-500">{RECENT_LABEL}</p>
          <div className="flex gap-1">
            {recent.slice(0, RECENT_LIMIT).map((item) => (
              <button
                key={item}
                type="button"
                title={nameForHex(item)}
                aria-label={nameForHex(item)}
                onClick={() => choose(item)}
                style={{ backgroundColor: item }}
                className="h-6 w-6 rounded-sm border border-line transition-colors duration-base ease-standard hover:border-ink-300"
              />
            ))}
          </div>
        </div>
      : null}
    </div>
  )
}
