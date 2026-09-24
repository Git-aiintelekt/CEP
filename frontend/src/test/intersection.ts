/**
 * jsdom has no IntersectionObserver. This stand-in is installed for every test (see setup.ts): nothing is in view
 * until a test says so, so pages built from lazy parts stay light unless a test is about them.
 */
type Entry = { element: Element; callback: IntersectionObserverCallback; observer: IntersectionObserver }
let watched: Entry[] = []

class FakeIntersectionObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds = []
  private callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
  }
  observe(element: Element) {
    watched.push({ element, callback: this.callback, observer: this as unknown as IntersectionObserver })
  }
  unobserve(element: Element) {
    watched = watched.filter((entry) => entry.element !== element || entry.observer !== (this as unknown as IntersectionObserver))
  }
  disconnect() {
    watched = watched.filter((entry) => entry.observer !== (this as unknown as IntersectionObserver))
  }
  takeRecords() {
    return []
  }
}

export function installFakeIntersectionObserver() {
  watched = []
  globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver
}

/** Everything being watched that matches (default: everything) scrolls into view. */
export function scrollIntoView(match: (element: Element) => boolean = () => true) {
  for (const entry of watched.filter((candidate) => match(candidate.element))) {
    entry.callback([{ target: entry.element, isIntersecting: true } as IntersectionObserverEntry], entry.observer)
  }
}

/** How many elements are waiting to come into view. */
export const watchedCount = () => watched.length
