/**
 * Keeps a value the reader chose out of the plugin's default-stripping.
 *
 * grapesjs-mjml gives each type a 'style-default' and does two things with it: it copies those values into every
 * component's attributes at init, and its getAttrToHTML deletes any attribute whose value equals one of them.
 * So choosing 13px for body text emitted a bare <mj-text> and the email fell back to mj-attributes (15px) —
 * the reader picked one size and the inbox rendered another.
 *
 * Emptying 'style-default' stops both halves at once. Nothing is injected, so nothing has to be stripped, and an
 * untouched block emits exactly what it did before: nothing at all. The values themselves are not lost — every
 * one of them is also MJML's own default, which the compiler applies when the attribute is absent.
 *
 * Must run after grapesjs.init and before any design is loaded: addType rebuilds the model class, and only
 * components created afterwards use it.
 */
import type { Editor } from 'grapesjs'

/** Every plugin type that carries a style-default, which is every one we can put in an email. */
export const STRIPPING_TYPES = [
  'mj-body', 'mj-wrapper', 'mj-section', 'mj-group', 'mj-column', 'mj-text', 'mj-button', 'mj-image',
  'mj-divider', 'mj-spacer', 'mj-social', 'mj-social-element', 'mj-navbar', 'mj-navbar-link', 'mj-hero', 'mj-raw',
] as const

/** Returns the types it changed, so a caller can tell when a plugin upgrade has moved them. */
export function keepChosenValues(editor: Editor): string[] {
  const changed: string[] = []
  for (const type of STRIPPING_TYPES) {
    if (!editor.Components.getType(type)) continue
    // addType on an existing id extends it: every other default, stylable included, is left alone.
    editor.Components.addType(type, { model: { defaults: { 'style-default': {} } } })
    changed.push(type)
  }
  return changed
}
