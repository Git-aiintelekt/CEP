/**
 * The sign-in loader has to outlast the navigation it covers: if it faded out while still inside LoginPage it would
 * reveal the login form again on its way out. This little store holds its state instead, so a host rendered above the
 * router can keep it running across the route change and then fade it onto the dashboard underneath.
 */
/**
 * How long the log-in animation plays once the credentials are accepted. Held at 5s so a full sweep of the converging
 * dots plays out. Tests set VITE_LOADING_HOLD_MS=0 so the suite does not sit through it.
 */
export const LOADING_HOLD_MS = Number(import.meta.env.VITE_LOADING_HOLD_MS ?? 5000)

interface State {
  label: string | null
  exiting: boolean
}

let state: State = { label: null, exiting: false }
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  listeners.forEach((listener) => listener())
}

export const loadingOverlay = {
  show: (label: string) => set({ label, exiting: false }),
  /** Start the fade; call hide() once it has finished. */
  fadeOut: () => set({ ...state, exiting: true }),
  hide: () => set({ label: null, exiting: false }),
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  snapshot: () => state,
}
