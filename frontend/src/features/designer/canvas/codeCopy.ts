/** The Email code dialog's words, kept apart from the component so the tests and the component share one copy. */
export const CODE_TITLE = 'Email code'
export const CODE_NOTE = 'The HTML that is sent is built by the server from this MJML when you save.'
export const MJML_TAB = 'MJML'
export const HTML_TAB = 'HTML'
export const CLOSE_LABEL = 'Close'
export const COPY_LABEL = 'Copy'
export const COPIED_TOAST = 'Copied'
export const COPY_FAILED_TOAST = 'Could not copy the code'
export const DOWNLOAD_HTML_LABEL = 'Download .html'
export const DOWNLOAD_MJML_LABEL = 'Download .mjml'
export const EDIT_LABEL = 'Edit MJML'
export const APPLY_LABEL = 'Apply changes'
export const APPLY_HINT = 'Change the code to apply it.'
export const DISCARD_LABEL = 'Discard'
export const EDITOR_LABEL = 'MJML code'
export const REPLACE_WARNING = 'Changes replace the whole design. Layer names are reset.'
export const FORMATTED_HINT = 'Shown formatted. Line breaks you typed are not kept.'
export const SHOW_DETAILS = 'Show details'
export const HIDE_DETAILS = 'Hide details'
export const APPLIED_TOAST = 'Code applied'

export const GATE_TITLE = 'Edit the code?'
export const GATE_NOTE = 'Advanced: editing the code directly can break the layout.'
export const GATE_CANCEL = 'Cancel'
export const GATE_CONFIRM = 'Edit code'

export const DISCARD_TITLE = 'Discard your code changes?'
export const DISCARD_NOTE = 'The code you changed has not been applied. Discarding it keeps the design as it is.'
export const KEEP_EDITING = 'Keep editing'
export const DISCARD_CONFIRM = 'Discard changes'

/** The warning is shown once per browser session: whoever has read it once is not asked again until they return. */
const GATE_KEY = 'cep.designer.codeGateSeen'
let seenThisSession = false

export function codeGateSeen(): boolean {
  if (seenThisSession) return true
  try {
    return window.sessionStorage.getItem(GATE_KEY) === '1'
  } catch {
    return false
  }
}

export function rememberCodeGate(): void {
  seenThisSession = true
  try {
    window.sessionStorage.setItem(GATE_KEY, '1')
  } catch {
    // private windows can refuse storage; the flag above still covers this page
  }
}

/** For tests: a new session. */
export function forgetCodeGate(): void {
  seenThisSession = false
  try {
    window.sessionStorage.removeItem(GATE_KEY)
  } catch {
    // nothing stored to forget
  }
}
