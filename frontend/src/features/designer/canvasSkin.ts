/**
 * The stylesheet injected into the GrapesJS canvas iframe.
 *
 * designer.css styles the parent document only: the frame is a separate document that cannot see the app's
 * custom properties, so the tokens are resolved here and written in as literals. Nothing is hard-coded — an
 * unreadable token yields an invalid declaration, which the browser drops, leaving GrapesJS's own default.
 *
 * Only the editing chrome is touched. The email's own styles are never changed.
 */
import { HIDE_MOBILE_CLASS, SHADOW_CSS, SHADOW_LEVELS, shadowClass } from './blocks/register'
import { HIDDEN_ATTRIBUTE } from './layers/hidden'

export const CANVAS_SKIN_ID = 'cep-canvas-skin'

/**
 * Set on the frame's root element while the canvas is at the phone width. The rule below always ships, so a
 * device change is one attribute rather than a fresh stylesheet — which a canvas re-render would otherwise undo.
 */
export const PHONE_ATTRIBUTE = 'data-cep-phone'

/**
 * What a phone does with a block hidden on phones. The canvas draws the components, not the compiled email, so
 * the design's own mj-style never reaches this document and the rule is mirrored here instead. The attribute
 * selector matches too: css-class only becomes a real class when MJML compiles the email.
 */
function hiddenOnPhonesCss(): string {
  return `
[${PHONE_ATTRIBUTE}] .${HIDE_MOBILE_CLASS},
[${PHONE_ATTRIBUTE}] [css-class~="${HIDE_MOBILE_CLASS}"] {
  display: none !important;
}
`
}

/** Tells the frame whether it is standing in for a phone. Re-applied whenever GrapesJS rebuilds the document. */
export function paintPhoneWidth(frame: Document | undefined | null, onPhone: boolean): void {
  const root = frame?.documentElement
  if (!root) return
  if (onPhone) root.setAttribute(PHONE_ATTRIBUTE, '')
  else root.removeAttribute(PHONE_ATTRIBUTE)
}

/**
 * `zoom` is the canvas zoom as a decimal. The frame is scaled as a whole, so a 1px outline drawn inside it would
 * render at half a pixel at 50%; dividing by the zoom keeps every outline one device pixel wide.
 */
export function canvasSkin(root: Element = document.documentElement, zoom = 1): string {
  const style = getComputedStyle(root)
  const token = (name: string) => style.getPropertyValue(name).trim()
  const line = `${Number((1 / (zoom > 0 ? zoom : 1)).toFixed(3))}px`

  const hairline = token('--color-line')
  const action = token('--color-brand-600')
  const emphasis = token('--color-ink-300')
  const sunken = token('--color-surface-subtle')

  // GrapesJS defines the same selectors, also with !important, in a <style> it puts in the frame BODY — which
  // beats the head on document order. Doubling the class raises specificity, so these win wherever they land.
  return `
/* The frame's own page scrollbar is hidden: it sits beside the email and reads as part of the design. Wheel,
   trackpad, keyboard and touch scrolling are unchanged. */
html {
  scrollbar-width: none;
}
html::-webkit-scrollbar {
  display: none;
}
.gjs-dashed.gjs-dashed *[data-gjs-highlightable] {
  outline: ${line} dashed ${hairline};
  outline-offset: 0;
}
.gjs-hovered.gjs-hovered {
  outline: ${line} solid ${emphasis} !important;
  outline-offset: 0 !important;
  background-color: transparent;
}
.gjs-selected.gjs-selected {
  outline: ${line} solid ${action} !important;
  outline-offset: 0 !important;
  box-shadow: none !important;
}
.gjs-selected-parent.gjs-selected-parent {
  outline: ${line} solid ${hairline} !important;
}
/* An image with no source yet. GrapesJS outlines it 3px in amber from a stylesheet it writes into the frame;
   the system has no orange and nothing outlined thicker than 1px, so it reads as a waiting slot instead. */
.gjs-plh-image.gjs-plh-image {
  background: ${sunken};
  outline: ${line} dashed ${emphasis};
  outline-offset: 0;
}
/* Hidden on the canvas only: the attribute is painted onto the frame's DOM and never onto the component model,
   so the MJML, the compiled HTML and the saved project are identical whether a block is hidden or not. */
[${HIDDEN_ATTRIBUTE}][${HIDDEN_ATTRIBUTE}] {
  display: none !important;
}
${hiddenOnPhonesCss()}`
}

export const DESIGN_RULES_ID = 'cep-design-rules'

/**
 * The design's own head rules the canvas cannot otherwise see: the shadow classes. Not part of the skin, which
 * styles the editing chrome alone; these are the email's rules, with the email's colours, drawn where the
 * compiled email would draw them. The attribute selector matches too: css-class only becomes a real class
 * when MJML compiles the email.
 */
export function designRules(): string {
  return SHADOW_LEVELS.map((level) => `
.${shadowClass(level)},
[css-class~="${shadowClass(level)}"] {
  box-shadow: ${SHADOW_CSS[level]};
}
`).join('')
}

/** Puts the skin, and the design rules beside it, into a frame document, replacing any earlier copy. */
export function injectCanvasSkin(frame: Document | undefined | null, css: string): void {
  if (!frame?.head) return
  for (const [id, text] of [[CANVAS_SKIN_ID, css], [DESIGN_RULES_ID, designRules()]]) {
    frame.getElementById(id)?.remove()
    const tag = frame.createElement('style')
    tag.id = id
    tag.textContent = text
    frame.head.appendChild(tag)
  }
}
