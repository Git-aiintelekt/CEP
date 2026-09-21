/** The picker's words, kept apart from the component so the tests and the component share one copy. */
export const SEARCH_LABEL = 'Search tags'
export const NO_MATCH_NOTE = 'No tags match'
export const EMPTY_CATALOGUE_NOTE = 'No tags are defined for this channel yet.'
export const RECENT_LABEL = 'Recent'
export const NO_DEFAULT_NOTE = 'No default value'
export const defaultNote = (value: string) => `If empty: ${value}`
/** the toast when a tag is copied rather than inserted, in the design's words */
export const copiedToast = (token: string): [string, string] => [`Copied ${token}`, 'Paste it into any text block or field']
export const copyFailedToast = (token: string, reason: string): [string, string] => [`Could not copy ${token}`, `${reason}. Type it in where the text goes.`]
