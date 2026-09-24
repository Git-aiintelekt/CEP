import { useEffect, useState, type RefObject } from 'react'

/**
 * Whether an element has come into view, for work worth doing only once someone can see it (like lazy images).
 * Latches: once seen, it stays true, so scrolling away does not tear the work down again.
 * Without IntersectionObserver (very old browsers) everything counts as seen.
 */
export function useInView(ref: RefObject<Element | null>, { rootMargin = '200px' }: { rootMargin?: string } = {}): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const element = ref.current
    if (seen || !element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true)
        observer.disconnect()
      }
    }, { rootMargin })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, rootMargin, seen])
  return seen
}
