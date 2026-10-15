/** What an email link may be. */
export const LINK_ERROR = 'Use a web address, mailto: or tel:'

const ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'tel']
const DANGEROUS_SCHEMES = ['javascript', 'data', 'vbscript']

const SCHEME = /^([a-z][a-z0-9+.-]*):/i

export function linkError(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (trimmed.startsWith('#')) return null
  if (trimmed.startsWith('{{')) return null // a personalization tag supplies the whole address

  /*
   * Two passes, and they are not interchangeable.
   *
   * The first reads the scheme again with every space and control character removed, because
   * "JaVa\nScript:alert(1)" is the same attack written to slip past a naive prefix check. It can only reject.
   *
   * The second reads the value exactly as it will be written. Judging that one on the stripped text would let
   * "htt ps://example.com" through as if it were https, and we would put that broken address in the email.
   */
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const hidden = SCHEME.exec(trimmed.replace(/[\s\u0000-\u001f\u007f-\u009f]/g, ''))
  if (hidden !== null && DANGEROUS_SCHEMES.includes(hidden[1].toLowerCase())) return LINK_ERROR

  const scheme = SCHEME.exec(trimmed)
  if (scheme === null) return LINK_ERROR // a bare host has no scheme, and email needs an absolute address
  return ALLOWED_SCHEMES.includes(scheme[1].toLowerCase()) ? null : LINK_ERROR
}
