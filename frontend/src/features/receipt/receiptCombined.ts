/**
 * The email a customer receives: the compiled outer design with the receipt in its slot. Built as one HTML
 * document so Preview & Test can show it in a sandboxed frame, exactly as it would arrive.
 */
import type { EmailDesignerHandle } from '@/features/designer/EmailDesigner'
import { isEmptyDesign } from '@/features/designer/preview/previewState'
import type { ReceiptSection } from '@/lib/types'

import { injectReceiptIntoOuterHtml } from './injectReceipt'
import { RECEIPT_HIDE_MOBILE_STYLE, renderReceiptEmailHtml } from './receiptEmailHtml'
import type { SampleTransaction } from './sampleReceiptData'

/** Some clients keep only the <style> in <head>, so the phone rule is placed there too. No head, no insert. */
export function withHeadStyle(html: string, css: string): string {
  const at = html.search(/<\/head>/i)
  return at === -1 ? html : `${html.slice(0, at)}<style>${css}</style>${html.slice(at)}`
}

export function combineReceiptEmail(outerHtml: string, sections: ReceiptSection[], transaction: SampleTransaction): string {
  return injectReceiptIntoOuterHtml(withHeadStyle(outerHtml, RECEIPT_HIDE_MOBILE_STYLE), renderReceiptEmailHtml(sections, transaction))
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

/** What the frame shows when there is no email to show yet: a sentence, never a half-rendered email. */
export function previewMessage(title: string, details: string[] = []): string {
  const escape = (text: string) => text.replace(/[&<>]/g, (character) => ESCAPES[character])
  const list = details.length ? `<ul style="margin:8px 0 0;padding-left:18px;">${details.map((detail) => `<li>${escape(detail)}</li>`).join('')}</ul>` : ''
  return `<!doctype html><html><body style="margin:0;padding:24px;font-family:Helvetica, Arial, sans-serif;font-size:14px;line-height:20px;color:#6b6f7b;"><p style="margin:0;font-weight:600;color:#17181c;">${escape(title)}</p>${list}</body></html>`
}

export const NOT_READY = 'The outer design is still loading.'
export const EMPTY_DESIGN = 'The outer design has no blocks yet.'
export const COMPILE_FAILED = 'The outer design has errors, so the email cannot be shown yet.'

type Compiler = Pick<EmailDesignerHandle, 'getMjml' | 'compileHtml'>

/** The compiled outer design, or the sentence to show instead of it. */
export type OuterEmail = { ready: true; html: string } | { ready: false; message: string }

/**
 * Compiled once each time Preview & test opens, then filled for each sample without compiling again. As the Email
 * designer's Preview does, an editor not ready, an empty design or a failed compile is said, never shown.
 */
export function compileOuter(editor: Compiler | null | undefined): OuterEmail {
  if (!editor) return { ready: false, message: previewMessage(NOT_READY) }
  try {
    if (isEmptyDesign(editor.getMjml())) return { ready: false, message: previewMessage(EMPTY_DESIGN) }
    const { html, errors } = editor.compileHtml()
    if (errors.length > 0) return { ready: false, message: previewMessage(COMPILE_FAILED, errors) }
    return { ready: true, html }
  } catch (error) {
    return { ready: false, message: previewMessage(COMPILE_FAILED, [error instanceof Error ? error.message : String(error)]) }
  }
}

export function combinedFor(outer: OuterEmail, sections: ReceiptSection[], transaction: SampleTransaction): string {
  return outer.ready ? combineReceiptEmail(outer.html, sections, transaction) : outer.message
}
