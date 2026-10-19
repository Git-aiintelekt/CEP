/** The width of a visual's box, followed as the page resizes. */
import { useLayoutEffect, useRef, useState } from 'react'

const FALLBACK_WIDTH = 640

export function useBoxWidth(fallback = FALLBACK_WIDTH) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [box, width || fallback] as const
}
