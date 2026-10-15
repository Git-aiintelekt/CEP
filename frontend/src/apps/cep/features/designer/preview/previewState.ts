/** What the Preview tab has to show, and how it is built from the editor. */
import type { EmailDesignerHandle } from '../EmailDesigner'

export type PreviewState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'failed'; details: string[] }
  /** builtAt: when it was compiled, which the inbox row shows as the time it arrived */
  | { status: 'ready'; html: string; builtAt: string }

/** A body with no blocks in it: there is nothing to preview, rather than an empty white page. */
export function isEmptyDesign(mjml: string): boolean {
  const body = /<mj-body\b[^>]*>([\s\S]*?)<\/mj-body>/i.exec(mjml)
  return body === null || !/<mj-/i.test(body[1])
}

type PreviewSource = Pick<EmailDesignerHandle, 'commitEdit' | 'getMjml' | 'compileHtml'>

/**
 * Commits any text still being typed, then compiles. A compile that reports errors, or throws, is a failure: the
 * half-rendered email it may still have produced is never shown, because it is not what anyone would receive.
 */
export async function buildPreview(editor: PreviewSource | null | undefined): Promise<PreviewState> {
  if (!editor) return { status: 'failed', details: ['The editor is not ready.'] }
  try {
    await editor.commitEdit()
    if (isEmptyDesign(editor.getMjml())) return { status: 'empty' }
    const result = editor.compileHtml()
    if (result.errors.length > 0) return { status: 'failed', details: result.errors }
    return { status: 'ready', html: result.html, builtAt: new Date().toISOString() }
  } catch (error) {
    return { status: 'failed', details: [error instanceof Error ? error.message : String(error)] }
  }
}
