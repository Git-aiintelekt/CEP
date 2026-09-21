/**
 * Hand-edited MJML into the design. Never through load(): that clears the undo history and marks the design as
 * saved, and replacing the design by hand is an edit like any other — one undo step, and unsaved until saved.
 */
import { expandSelfClosing } from '../mjml'
import { describeAdjustments } from './codeAdjustments'
import type { Compile } from './codeChecks'

/** Only what applying touches, so a test can stand one up with plain functions. */
export interface CodeHost {
  select: (components: []) => unknown
  setComponents: (mjml: string) => unknown
  getHtml: () => string
  runCommand: (id: string, options?: Record<string, unknown>) => unknown
}

/** Compiles a string of MJML without touching the design: the plugin's command, handed the code to use. */
export function compileWith(editor: Pick<CodeHost, 'runCommand'>): Compile {
  return (mjml) => editor.runCommand('mjml-code-to-html', { mjml }) as ReturnType<Compile>
}

/** The rules that follow an edit — the one-footer rule, the hide-on-phones sync — finish on the next task. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export async function applyCode(editor: CodeHost, text: string): Promise<{ applied: string; changes: string[] }> {
  const typed = expandSelfClosing(text)
  // nothing stays selected: the block it pointed at is gone
  editor.select([])
  editor.setComponents(typed)
  await settled()
  const applied = editor.getHtml()
  return { applied, changes: describeAdjustments(typed, applied) }
}
