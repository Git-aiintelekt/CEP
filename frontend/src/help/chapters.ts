/**
 * The User Guide's chapters the app can show: a key per page, loaded from docs/manuals/user-guide only when a help panel
 * opens (each chapter is its own chunk). A page names its chapter on its PageHelp icon.
 */
export const HELP_CHAPTERS = {
  introduction: { title: 'Welcome to CEP', load: () => import('../../../docs/manuals/user-guide/00-introduction.md?raw').then((module) => module.default) },
  home: { title: 'Home', load: () => import('../../../docs/manuals/user-guide/10-home.md?raw').then((module) => module.default) },
  'contact-lists': { title: 'Contact Lists', load: () => import('../../../docs/manuals/user-guide/20-contact-lists.md?raw').then((module) => module.default) },
  campaigns: { title: 'Campaigns', load: () => import('../../../docs/manuals/user-guide/30-campaigns.md?raw').then((module) => module.default) },
  'campaign-setup': { title: 'Campaign Set-Up', load: () => import('../../../docs/manuals/user-guide/32-campaign-setup.md?raw').then((module) => module.default) },
  templates: { title: 'Templates and Content', load: () => import('../../../docs/manuals/user-guide/34-templates.md?raw').then((module) => module.default) },
  'email-designer': { title: 'The Email Designer', load: () => import('../../../docs/manuals/user-guide/36-email-designer.md?raw').then((module) => module.default) },
  'settings-sending-engines': { title: 'Sending Engines and Senders', load: () => import('../../../docs/manuals/user-guide/40-settings-sending-engines.md?raw').then((module) => module.default) },
} as const

export type HelpChapter = keyof typeof HELP_CHAPTERS

/** the chapter of a page, by its route; a page without one has no help icon yet */
export const HELP_FOR_PAGE: Partial<Record<string, HelpChapter>> = {
  '/': 'home',
  '/campaigns': 'campaigns',
  '/campaigns/new': 'campaign-setup',
  '/templates': 'templates',
  '/templates/new': 'templates',
  '/contact-lists': 'contact-lists',
  '/settings/delivery': 'settings-sending-engines',
}
