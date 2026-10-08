import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const TOOLTIP_DELAY = 300
const GAP = 8
const EDGE = 8

interface TooltipProps {
  content: ReactNode
  /** one element; it gets aria-describedby while the tooltip shows */
  children: ReactElement<{ 'aria-describedby'?: string }>
  /** checked when the tooltip is about to show, so a caller can decide late (TruncatedText measures then) */
  disabled?: boolean | (() => boolean)
  className?: string
}

/**
 * A dark 12px label above its trigger, flipping below near the top of the window. Shows after 300ms on hover and at
 * once on keyboard focus; Escape, blur and leaving hide it. A focus that follows a press is a click, so it waits too.
 */
export function Tooltip({ content, children, disabled = false, className = '' }: TooltipProps) {
  const id = useId()
  const anchor = useRef<HTMLSpanElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const pressed = useRef(false)
  const [shown, setShown] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  const blocked = useCallback(() => (typeof disabled === 'function' ? disabled() : disabled), [disabled])
  const show = useCallback(() => {
    if (!blocked()) setShown(true)
  }, [blocked])
  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setShown(false)
    setPosition(null)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  useLayoutEffect(() => {
    if (!shown || !anchor.current || !tip.current) return
    const target = anchor.current.getBoundingClientRect()
    const box = tip.current.getBoundingClientRect()
    const above = target.top - GAP - box.height
    const top = above < EDGE ? target.bottom + GAP : above
    const centred = target.left + target.width / 2 - box.width / 2
    const left = Math.max(EDGE, Math.min(centred, window.innerWidth - box.width - EDGE))
    setPosition({ left, top })
  }, [shown, content])

  useEffect(() => {
    if (!shown) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shown, hide])

  return (
    <span
      ref={anchor}
      className={`inline-flex min-w-0 ${className}`}
      onMouseEnter={() => {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(show, TOOLTIP_DELAY)
      }}
      onMouseLeave={hide}
      onPointerDown={() => {
        pressed.current = true
      }}
      onFocus={() => {
        if (!pressed.current) show()
        pressed.current = false
      }}
      onBlur={hide}
    >
      {cloneElement(children, { 'aria-describedby': shown ? id : children.props['aria-describedby'] })}
      {shown &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            data-tooltip
            style={position ?? { left: 0, top: 0, visibility: 'hidden' }}
            className="pointer-events-none fixed z-50 max-w-[280px] rounded-sm bg-toast px-2 py-1 text-xs font-medium text-on-brand shadow-toast"
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  )
}

interface TruncatedTextProps {
  text: string
  className?: string
  /** make the text a tab stop when it is cut, so keyboard users can read the rest; off inside links and buttons */
  focusable?: boolean
}

/** One line, cut with an ellipsis; the full text shows in a Tooltip, but only when it is actually cut. */
export function TruncatedText({ text, className = '', focusable = false }: TruncatedTextProps) {
  const element = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)
  const measure = useCallback(() => {
    const node = element.current
    const isCut = Boolean(node && node.scrollWidth > node.clientWidth)
    setCut(isCut)
    return isCut
  }, [])

  useLayoutEffect(() => {
    measure()
    if (typeof ResizeObserver === 'undefined' || !element.current) return
    const observer = new ResizeObserver(() => measure())
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [measure, text])

  return (
    <Tooltip content={text} disabled={() => !measure()} className={`max-w-full ${className}`}>
      <span ref={element} data-truncated={cut || undefined} tabIndex={focusable && cut ? 0 : undefined} className="block min-w-0 truncate">
        {text}
      </span>
    </Tooltip>
  )
}
