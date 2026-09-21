import { useEffect, useState } from 'react'

/** Tailwind's default breakpoints, so JS and the `md:` / `xl:` classes always agree. */
export const BREAKPOINT = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const

function matches(query: string): boolean {
  // jsdom and old browsers have no matchMedia: behave like a wide desktop
  return typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : true
}

/** True while the viewport is at least `min` pixels wide. */
export function useMinWidth(min: number): boolean {
  const query = `(min-width: ${min}px)`
  const [value, setValue] = useState(() => matches(query))

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const list = window.matchMedia(query)
    const onChange = () => setValue(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return value
}
