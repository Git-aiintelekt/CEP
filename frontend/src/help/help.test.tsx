/** Help in the app: the Markdown subset the chapters use, the page panel opened from a page's help icon, a field's note. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { installMockApi, signIn } from '@/test/mockApi'

import { Markdown } from './markdown'
import { parse, titleOf } from './markdownParse'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const SAMPLE = `# Sending Engines

**Where:** Settings → Sending.

## What this page is for

Nothing leaves CEP without an engine, *checked* first. See [Contact Lists](/contact-lists) and \`provider.edit\`.

| Control | What it is | What it changes |
|---|---|---|
| Check | Asks the provider. | Sets State. |
| Edit | Opens the form. | |

- first point
- second point
  continued

1. step one
2. step two

> a quote
`

test('the Markdown subset: headings, paragraphs, tables, lists, quotes; bold, italics, code and links inline; the title is the first H1', () => {
  expect(titleOf(SAMPLE)).toBe('Sending Engines')
  expect(parse(SAMPLE).map((block) => block.kind)).toEqual(['heading', 'paragraph', 'heading', 'paragraph', 'table', 'list', 'list', 'quote'])
  render(<MemoryRouter><Markdown source={SAMPLE} skipTitle /></MemoryRouter>)
  expect(screen.queryByRole('heading', { name: 'Sending Engines' })).toBeNull()                        // the title is shown by the panel's header
  expect(screen.getByRole('heading', { level: 3, name: 'What this page is for' })).toBeTruthy()
  expect(screen.getByText('Where:').tagName).toBe('STRONG')
  expect(screen.getByText('provider.edit').tagName).toBe('CODE')
  expect(screen.getByText('checked').tagName).toBe('EM')
  expect(screen.getByRole('link', { name: 'Contact Lists' }).getAttribute('href')).toBe('/contact-lists')
  const table = screen.getByRole('table')
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Control', 'What it is', 'What it changes'])
  expect(within(table).getAllByRole('row')).toHaveLength(3)
  expect(within(table).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Check', 'Asks the provider.', 'Sets State.', 'Edit', 'Opens the form.', ''])
  const [bullets, numbers] = screen.getAllByRole('list')
  expect(within(bullets).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['first point', 'second point continued'])
  expect(numbers.tagName).toBe('OL')
  expect(screen.getByText('a quote').tagName).toBe('BLOCKQUOTE')
})

test('the help icon beside a page title opens its chapter in a panel; Escape closes it and focus returns to the icon', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/contact-lists')
  const icon = await screen.findByRole('button', { name: 'Help for this page' })
  expect(screen.queryByRole('complementary', { name: /Contact Lists/ })).toBeNull()
  await user.click(icon)
  const panel = await screen.findByRole('complementary', { name: 'Contact Lists' })
  expect(within(panel).getByText('Help')).toBeTruthy()
  expect(await within(panel).findByRole('heading', { level: 3, name: 'What this page is for' })).toBeTruthy()      // the chapter's own sections
  expect(within(panel).getByRole('heading', { level: 3, name: 'The fields and controls' })).toBeTruthy()
  expect(within(panel).getAllByRole('table').length).toBeGreaterThan(1)
  expect(document.activeElement).toBe(within(panel).getByRole('button', { name: 'Close help' }))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('complementary', { name: 'Contact Lists' })).toBeNull()
  expect(document.activeElement).toBe(icon)
})

test('a field note: the information icon beside the label opens the note on that field', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/delivery')
  await user.click(await screen.findByRole('button', { name: 'Add Engine' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a Sending Engine' })
  expect(within(dialog).queryByRole('note')).toBeNull()
  await user.click(within(dialog).getByRole('button', { name: 'About Messages per Minute' }))
  expect(within(dialog).getByRole('note').textContent).toContain('spreads a run over time')
  await user.click(within(dialog).getByRole('button', { name: 'About Messages per Minute' }))
  expect(within(dialog).queryByRole('note')).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Add a Sending Engine' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Help for this page' })).toBeTruthy()                     // the page's own help icon, beside Sending Engines
})

test('every page with a chapter opens it from the icon beside its title: Home, Campaigns, a campaign, Templates', async () => {
  installMockApi()
  const user = userEvent.setup()
  for (const [path, title, wait] of [['/', 'Home', /^Good (morning|afternoon|evening), Aby$/], ['/campaigns', 'Campaigns', 'Campaigns'], ['/campaigns/c1', 'Campaigns', 'Fall Launch'], ['/templates', 'Templates and Content', 'Templates']] as const) {
    await renderAppAt(path)
    await screen.findByRole('heading', { level: 1, name: wait })
    await user.click(screen.getByRole('button', { name: 'Help for this page' }))
    const panel = await screen.findByRole('complementary', { name: title })
    expect(await within(panel).findByRole('heading', { level: 3, name: 'What this page is for' })).toBeTruthy()
    cleanup()
  }
})

test('every settings page opens its chapter from the icon in the trail; Account Security from its title', async () => {
  installMockApi()
  const user = userEvent.setup()
  for (const [path, title] of [['/settings/users', 'Users'], ['/settings/roles', 'Roles'], ['/settings/api-keys', 'API Keys'], ['/settings/consent', 'Consent Policy'], ['/settings/setup', 'Setting Up a New Workspace']] as const) {
    await renderAppAt(path)
    const trail = await screen.findByRole('navigation', { name: 'Where you are' })
    await user.click(within(trail).getByRole('button', { name: 'Help for this page' }))
    const panel = await screen.findByRole('complementary', { name: title })
    expect(await within(panel).findByRole('heading', { level: 3, name: /^What this (page is for|is)$/ })).toBeTruthy()   // the set-up chapter is a path, not a page
    cleanup()
  }
  await renderAppAt('/account/security')
  await screen.findByRole('heading', { level: 1, name: 'Account Security' })
  await user.click(screen.getByRole('button', { name: 'Help for this page' }))
  expect(await screen.findByRole('complementary', { name: 'Account Security' })).toBeTruthy()
})
