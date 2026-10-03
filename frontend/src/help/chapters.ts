/**
 * The User Guide's chapters the app can show: a key per page, loaded from docs/manuals/user-guide only when a help panel
 * opens (each chapter is its own chunk). A page names its chapter on its PageHelp icon.
 */
export const HELP_CHAPTERS = {
  introduction: { title: 'Welcome to CEP', load: () => import('../../../docs/manuals/user-guide/00-introduction.md?raw').then((module) => module.default) },
  'contact-lists': { title: 'Contact Lists', load: () => import('../../../docs/manuals/user-guide/20-contact-lists.md?raw').then((module) => module.default) },
  'settings-sending-engines': { title: 'Sending Engines and Senders', load: () => import('../../../docs/manuals/user-guide/40-settings-sending-engines.md?raw').then((module) => module.default) },
} as const

export type HelpChapter = keyof typeof HELP_CHAPTERS

/** the chapter of a page, by its route; a page without one has no help icon yet */
export const HELP_FOR_PAGE: Partial<Record<string, HelpChapter>> = {
  '/contact-lists': 'contact-lists',
  '/settings/delivery': 'settings-sending-engines',
}
