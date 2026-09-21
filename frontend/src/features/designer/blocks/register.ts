/** Puts the palette into a GrapesJS editor. The panel that draws it is the editor's job, not this file's. */
import type { Component, Editor } from 'grapesjs'

import { BLOCK_CATEGORIES, CEP_BLOCKS, needsImage, withImage } from './registry'
import type { CepBlock } from './types'

export interface RegisterOptions {
  channel: string
  /** the picture blocks start with, or null while the workspace library is empty */
  imageUrl?: string | null
}

const CATEGORY_LABEL = new Map(BLOCK_CATEGORIES.map((category) => [category.id, category.label]))

/** A receipt is transactional and carries no unsubscribe link (see issues.ts), so it is offered no footer. */
export function blocksFor(channel: string): CepBlock[] {
  return channel === 'E_RECEIPT' ? CEP_BLOCKS.filter((block) => block.id !== 'footer') : CEP_BLOCKS
}

export function registerBlocks(editor: Editor, { channel, imageUrl = null }: RegisterOptions): void {
  for (const block of blocksFor(channel)) {
    editor.Blocks.add(block.id, {
      label: block.label,
      category: CATEGORY_LABEL.get(block.category) ?? block.category,
      content: blockContent(block, imageUrl),
      attributes: { 'data-icon': block.icon },
    })
  }
}

/**
 * The MJML a drop actually puts in. A picture block always has its token replaced — by a real address when
 * one was carried in, otherwise by nothing at all, which is what makes the picker open over the new block.
 */
export function blockContent(block: CepBlock, imageUrl: string | null): string {
  return needsImage(block) ? withImage(block, imageUrl ?? '') : block.mjml
}

/** What the next drop of a picture block carries: an image being dragged out of the library, or nothing. */
export function setBlockImage(editor: Editor, imageUrl: string | null): void {
  for (const block of CEP_BLOCKS) {
    if (!needsImage(block)) continue
    editor.Blocks.get(block.id)?.set('content', blockContent(block, imageUrl))
  }
}

export function blockIdsInOrder(channel: string): string[] {
  return blocksFor(channel).map((block) => block.id)
}

/** The one footer an email may have, set by blocks/footer.ts as an MJML css-class. */
export const FOOTER_CLASS = 'cep-footer'

/** A section the reader hid on phones. Carried the same way the footer's marker is: an MJML css-class. */
export const HIDE_MOBILE_CLASS = 'cep-hide-mobile'

/**
 * The one rule that makes that class do anything in a delivered email, held in mj-head as an mj-style.
 *
 * Never inline="inline": inlining moves declarations onto the elements themselves, which a media query cannot
 * survive, and the block would then be hidden everywhere instead of on phones.
 */
export const HIDE_MOBILE_RULE = `@media only screen and (max-width:480px){.${HIDE_MOBILE_CLASS}{display:none!important;max-height:0!important;overflow:hidden!important;font-size:0!important;line-height:0!important;}}`

function cssClasses(component: Component): string[] {
  return String(component.getAttributes()['css-class'] ?? '').split(/\s+/).filter((name) => name !== '')
}

/** css-class survives as a plain MJML attribute; a design edited in the style manager can also carry it as a class. */
export function hasCssClass(component: Component, name: string): boolean {
  if (cssClasses(component).includes(name)) return true
  // a component the panel is reading may not be a full GrapesJS model yet, and the attribute is the real home
  const classes = typeof component.getClasses === 'function' ? component.getClasses() : []
  return Array.isArray(classes) && classes.includes(name)
}

/** Adds or removes one class and leaves every other one — the footer's marker included — exactly as it was. */
export function setCssClass(component: Component, name: string, on: boolean): void {
  const kept = cssClasses(component).filter((item) => item !== name)
  const next = on ? [...kept, name] : kept
  if (next.length === 0) component.removeAttributes('css-class')
  else component.addAttributes({ 'css-class': next.join(' ') })
}

export function isFooter(component: Component): boolean {
  return hasCssClass(component, FOOTER_CLASS)
}

/** A block the reader hid on phones. It still ships: the media query is what stops phones drawing it. */
export function isHiddenOnPhones(component: Component): boolean {
  return hasCssClass(component, HIDE_MOBILE_CLASS)
}

function matchesIn(editor: Editor, predicate: (component: Component) => boolean): Component[] {
  const found: Component[] = []
  editor.getWrapper()?.onAll((component) => {
    if (predicate(component)) found.push(component)
  })
  return found
}

export function footersIn(editor: Editor): Component[] {
  return matchesIn(editor, isFooter)
}

export function hiddenOnPhonesIn(editor: Editor): Component[] {
  return matchesIn(editor, isHiddenOnPhones)
}

/** The mj-style holding our rule, told apart from any other one the design carries by the class it names. */
function holdsRule(style: Component): boolean {
  return `${String(style.get('content') ?? '')} ${style.toHTML()}`.includes(HIDE_MOBILE_CLASS)
}

export function hideMobileStylesIn(editor: Editor): Component[] {
  const wrapper = editor.getWrapper()
  if (!wrapper) return []
  return wrapper.findType('mj-style').filter(holdsRule)
}

/** mj-head, made if the design has none: a template imported as bare mj-body is still a design we must serve. */
function headOf(editor: Editor): Component | undefined {
  const wrapper = editor.getWrapper()
  if (!wrapper) return undefined
  const existing = wrapper.findType('mj-head')[0]
  if (existing) return existing
  const root = wrapper.findType('mjml')[0]
  if (!root) return undefined
  // mj-head must come before mj-body, which is the only child order MJML accepts
  const added = root.append('<mj-head></mj-head>', { at: 0 })
  return Array.isArray(added) ? added[0] : added
}

/**
 * Keeps mj-head carrying exactly one copy of the rule: added as soon as a block uses the class, taken away
 * again when the last one stops using it.
 *
 * Deliberately outside the undo stack. The head is derived from the blocks rather than edited alongside them,
 * so undoing the switch cannot leave a stale rule behind and redoing it cannot lose the rule — one undo step
 * moves the class, and this puts the head right again afterwards.
 */
export function syncHideMobileStyle(editor: Editor): void {
  if (!editor.getWrapper()) return
  const wanted = hiddenOnPhonesIn(editor).length > 0
  const present = hideMobileStylesIn(editor)
  if (present.length === (wanted ? 1 : 0)) return

  editor.UndoManager.stop()
  try {
    for (const extra of present.slice(wanted ? 1 : 0)) extra.remove()
    if (wanted && present.length === 0) headOf(editor)?.append(`<mj-style>${HIDE_MOBILE_RULE}</mj-style>`)
  } finally {
    editor.UndoManager.start()
  }
}

export interface FooterRuleOptions {
  channel: string
  readOnly?: boolean
  onNotice?: (message: string) => void
  /** true while a stored design is loading, when the rules watch but never edit it */
  isLoading: () => boolean
}

export const ONE_FOOTER_NOTICE = 'An email can have only one footer.'

/**
 * An email has exactly one footer: it cannot be deleted or duplicated, and a second one is turned away.
 * Returns the sweep to run once a design has loaded, which protects the footers it arrived with.
 */
export function applyFooterRules(editor: Editor, options: FooterRuleOptions): () => void {
  const active = !options.readOnly && options.channel === 'EMAIL'
  const sweep = () => {
    if (active) for (const footer of footersIn(editor)) protect(footer)
  }
  if (!active) return sweep

  // Footers that arrive together — a whole design replaced at once — are judged together, after they have all landed:
  // judged one by one, each would see the other and both would go, leaving the email with no unsubscribe link.
  // The footer already protected stays, or else the first in the email; every other is turned away.
  let judging = false
  const judge = () => {
    judging = false
    const footers = footersIn(editor)
    if (footers.length === 0) return
    const keep = footers.find((footer) => footer.get('removable') === false) ?? footers[0]
    const extra = footers.filter((footer) => footer !== keep)
    protect(keep)
    for (const footer of extra) footer.remove()
    if (extra.length > 0) options.onNotice?.(ONE_FOOTER_NOTICE)
  }

  editor.on('component:add', (component: Component) => {
    if (options.isLoading() || !isFooter(component)) return
    if (footersIn(editor).length === 1) {
      protect(component)
      return
    }
    // the drop is still in progress: removing a footer here is undone when the sorter finishes placing it
    if (!judging) {
      judging = true
      setTimeout(judge, 0)
    }
  })
  return sweep
}

/** The toolbar is built when the component is created, before these flags are set, so the dead buttons are
 *  cleared by hand: clicking them already does nothing. */
const DEAD_TOOLS = new Set(['tlb-clone', 'tlb-delete'])

function protect(component: Component): void {
  component.set({ removable: false, copyable: false })
  const toolbar = component.get('toolbar')
  if (Array.isArray(toolbar)) {
    component.set(
      'toolbar',
      toolbar.filter((item) => !DEAD_TOOLS.has(String((item as { command?: unknown }).command ?? ''))),
    )
  }
}
