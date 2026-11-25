/**
 * The picture that follows the pointer while something is carried by pointer events (the browser draws one only for its own
 * drag and drop): a copy of what was picked up, or a chip naming it. It follows the pointer over the page and over any
 * iframe given (a canvas), whose pointer positions are its own and are scaled when the frame is zoomed.
 */
export interface DragGhost {
  /** take the picture away; safe to call twice */
  stop: () => void
}

interface GhostOptions {
  /** frames the pointer may cross: their moves are followed too */
  frames?: (HTMLIFrameElement | null | undefined)[]
}

const GHOST_ATTRIBUTE = 'data-drag-ghost'
const CHIP = 'rounded-sm border border-line bg-surface px-3 py-2 text-xs font-medium whitespace-nowrap text-ink-800'
/** how far a chip sits from the pointer, so it never covers the place it is about to be dropped */
const CHIP_OFFSET = 14

let showing: DragGhost | null = null

function follow(ghost: HTMLElement, offset: { x: number; y: number }, { frames = [] }: GhostOptions): DragGhost {
  showing?.stop()
  const place = (x: number, y: number) => {
    ghost.style.transform = `translate3d(${Math.round(x - offset.x)}px, ${Math.round(y - offset.y)}px, 0)`
    ghost.style.visibility = 'visible'
  }
  // a canvas may hand its frame's moves on to the page as they are, in the frame's own coordinates (GrapesJS does, on the
  // iframe element): those are followed from inside the frame, below
  const onPage = (event: PointerEvent) => {
    if (!frames.includes(event.target as HTMLIFrameElement)) place(event.clientX, event.clientY)
  }
  const inFrame = (frame: HTMLIFrameElement) => (event: PointerEvent) => {
    const box = frame.getBoundingClientRect()
    const scale = frame.offsetWidth ? box.width / frame.offsetWidth : 1
    place(box.left + event.clientX * scale, box.top + event.clientY * scale)
  }
  const watched: [Document, (event: PointerEvent) => void][] = [[document, onPage]]
  for (const frame of frames) {
    const inside = frame?.contentDocument
    if (frame && inside) watched.push([inside, inFrame(frame)])
  }

  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    for (const [doc, moved] of watched) {
      doc.removeEventListener('pointermove', moved, true)
      doc.removeEventListener('pointerup', stop, true)
      doc.removeEventListener('pointercancel', stop, true)
    }
    ghost.remove()
    if (showing === handle) showing = null
  }
  const handle: DragGhost = { stop }
  for (const [doc, moved] of watched) {
    doc.addEventListener('pointermove', moved, true)
    doc.addEventListener('pointerup', stop, true)
    doc.addEventListener('pointercancel', stop, true)
  }

  // hidden until the pointer moves: a press that never travels is a click, and shows nothing
  document.body.appendChild(ghost)
  showing = handle
  return handle
}

function shell(scope: Element | null): HTMLElement {
  const ghost = document.createElement('div')
  ghost.setAttribute(GHOST_ATTRIBUTE, '')
  ghost.setAttribute('aria-hidden', 'true')
  // the editors' own corner and type scope, so the copy looks like the tile it was taken from
  ghost.className = `${scope ? 'editor-radii editor-type ' : ''}pointer-events-none fixed top-0 left-0 z-[2000] rounded-sm shadow-menu`
  ghost.style.visibility = 'hidden'
  ghost.style.willChange = 'transform'
  return ghost
}

/** A copy of `source` (a palette tile, a thumbnail) under the pointer, held where it was picked up (`at`). */
export function carryCopy(source: HTMLElement, options: GhostOptions & { at?: { x: number; y: number } } = {}): DragGhost {
  const box = source.getBoundingClientRect()
  const copy = source.cloneNode(true) as HTMLElement
  copy.removeAttribute('id')
  copy.removeAttribute('title')
  copy.setAttribute('tabindex', '-1')
  copy.style.width = `${box.width}px`
  copy.style.height = `${box.height}px`
  copy.style.margin = '0'
  copy.style.opacity = '0.92'
  const ghost = shell(source.closest('.editor-radii'))
  ghost.appendChild(copy)
  const at = options.at
  // held at the grip: the copy stays under the pointer exactly as the tile was when it was pressed
  const inside = at && at.x >= box.left && at.x <= box.right && at.y >= box.top && at.y <= box.bottom
  const offset = inside ? { x: at.x - box.left, y: at.y - box.top } : { x: box.width / 2, y: box.height / 2 }
  return follow(ghost, offset, options)
}

/** A chip saying what is carried (a block moved on the canvas), a little below and right of the pointer. */
export function carryLabel(label: string, options: GhostOptions & { scope?: Element | null } = {}): DragGhost {
  const ghost = shell(options.scope ?? null)
  const chip = document.createElement('div')
  chip.className = CHIP
  chip.textContent = label
  ghost.appendChild(chip)
  return follow(ghost, { x: -CHIP_OFFSET, y: -CHIP_OFFSET }, options)
}

/** For tests and for a page that is leaving: whatever is carried is put down. */
export function dropGhost(): void {
  showing?.stop()
}
