/**
 * The save error toast's detail line. The server's refusals are already plain words, all but one: when it cannot
 * compile the MJML it passes on its compiler's own message ("unexpected end of stream in root template"), which only
 * hand-edited code can cause. That one is said in the reader's words, pointing at where it can be fixed.
 */
export const UNREADABLE_CODE = 'The server couldn’t read the email’s code. Open View code, fix the MJML and save again.'

const RENDER_FAILED = /^The design could not be rendered\b/

export function saveErrorDetail(fieldErrors: Record<string, string>): string | undefined {
  const first = fieldErrors.mjml_source ?? Object.values(fieldErrors)[0]
  if (first === undefined) return undefined
  return RENDER_FAILED.test(first) ? UNREADABLE_CODE : first
}
