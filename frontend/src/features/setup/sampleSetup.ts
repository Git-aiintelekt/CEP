/** A workspace half way through its set-up: three steps done, the sender to verify next. The Home playground and the tests share it. */
import type { WorkspaceSetup } from '@/lib/types'

export const SAMPLE_SETUP: WorkspaceSetup = {
  workspace: { name: 'Northwind Apparel', code: 'NWA', plan: 'Growth', timezone: 'America/New_York' },
  viewer: { first_name: 'Aby' },
  steps: [
    { key: 'signin', label: 'Choose your password and sign in', state: 'done', tag: 'Done', text: 'Done 3 Oct 2026. Multi-factor authentication can be turned on under Account Security.', why: null,
      links: [{ label: 'Account Security', to: '/account/security', primary: false }], optional: false },
    { key: 'team', label: 'Invite your team and give them roles', state: 'done', tag: 'Done', text: '5 users · 2 signed in · roles Analyst, Campaign Manager, Marketing Admin. Approvals will need a role with campaign.approve.', why: null,
      links: [{ label: 'Users', to: '/settings/users', primary: false }], optional: false },
    { key: 'email_engine', label: 'Add an email engine', state: 'done', tag: 'Done', text: 'Postal (self-hosted) · checked 2 Oct 2026.', why: null,
      links: [{ label: 'Sending Engines', to: '/settings/delivery', primary: false }], optional: false },
    { key: 'email_sender', label: 'Add an email sender and verify it', state: 'warn', tag: 'Not verified', text: '1 sender, Northwind Rewards <rewards@northwindapparel.example>, not verified. Test sends work from it; production does not.',
      why: 'The domain must be one the engine may send for. Verify checks SPF and DKIM on the engine; it takes a minute once the DNS records are in.',
      links: [{ label: 'Verify Sender', to: '/settings/delivery#senders', primary: true }], optional: false },
    { key: 'text', label: 'Add a text engine and a sender number', state: 'todo', tag: null, text: 'Digivize, or Sandbox Texts to trial without an aggregator. Marketing texts need an opt-in and a STOP line.', why: null,
      links: [{ label: 'Sending Engines', to: '/settings/delivery', primary: false }], optional: true },
    { key: 'lists', label: 'Import your do-not-contact list, then your first contact list', state: 'todo', tag: null, text: 'No suppressions imported · no list yet. Every upload asks where its people agreed (the consent step).',
      why: 'Suppressions first, so nobody who opted out elsewhere is ever contacted; then a production list with its consent basis.',
      links: [{ label: 'Suppressions', to: '/settings/suppressions', primary: false }, { label: 'Upload a List', to: '/contact-lists', primary: true }], optional: false },
    { key: 'tell', label: 'Decide who is told, and who approves', state: 'todo', tag: null, text: 'Notifications: nobody yet · Approvals: off · API keys: none (needed for e-receipts from the point of sale).', why: null,
      links: [{ label: 'Notifications', to: '/settings/notifications', primary: false }, { label: 'Approvals', to: '/settings/approvals', primary: false }, { label: 'API Keys', to: '/settings/api-keys', primary: false }], optional: true },
  ],
  done: 3,
  total: 7,
  ready: false,
  next: 'email_sender',
  dismissed: false,
}

/** the same workspace with every step done */
export const SAMPLE_SETUP_READY: WorkspaceSetup = {
  ...SAMPLE_SETUP,
  steps: SAMPLE_SETUP.steps.map((step) => ({ ...step, state: 'done', tag: 'Done', why: null, links: step.links.map((link) => ({ ...link, primary: false })) })),
  done: 7,
  ready: true,
  next: null,
}
