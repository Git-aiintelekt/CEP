import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Eye, PencilRuler } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { EditorFrame, type EditorTabDef } from './EditorFrame'

type EditorTab = 'content' | 'preview'

const TABS: EditorTabDef<EditorTab>[] = [
  { id: 'content', label: 'Content', Icon: PencilRuler },
  { id: 'preview', label: 'Preview', Icon: Eye },
]

/** jsdom has no matchMedia; useMinWidth treats a missing one as a wide desktop, so only the narrow case needs a stub. */
function setViewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: width >= Number(/(\d+)px/.exec(query)?.[1] ?? 0),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

let mounts = 0

/** Counts its own mounts, so a remount of the content pane is visible to the test. */
function CountingChild({ label }: { label: string }) {
  useEffect(() => {
    mounts += 1
  }, [])
  return <p>{label}</p>
}

function Frame(props: Partial<React.ComponentProps<typeof EditorFrame<EditorTab>>> = {}) {
  const [tab, setTab] = useState<EditorTab>('content')
  return (
    <MemoryRouter>
      <EditorFrame
        name="Autumn rewards"
        status="DRAFT"
        saveNote="Version 3 · unsaved changes"
        backTo="/templates"
        tabs={TABS}
        tab={tab}
        onTabChange={setTab}
        panes={[
          { id: 'content', content: <CountingChild label="the canvas" /> },
          { id: 'preview', content: <p>the preview</p>, scrolls: true },
        ]}
        {...props}
      />
    </MemoryRouter>
  )
}

const tab = (name: string) => screen.getByRole('tab', { name })
/** Found through the tab's aria-controls, which keeps working once the panel is hidden. */
const panel = (name: string) => {
  const id = tab(name).getAttribute('aria-controls') ?? ''
  const element = document.getElementById(id)
  if (!element) throw new Error(`no panel wired to the ${name} tab`)
  return element
}

beforeEach(() => {
  mounts = 0
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the top bar shows the name, status and save note', () => {
  render(<Frame />)

  expect(screen.getByRole('heading', { name: 'Autumn rewards' })).toBeTruthy()
  expect(screen.getByText('Draft')).toBeTruthy()
  expect(screen.getByText('Version 3 · unsaved changes')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Back to Templates' }).getAttribute('href')).toBe('/templates')
})

test('the tabs carry the expected roles and wiring', () => {
  render(<Frame />)

  expect(screen.getByRole('tablist', { name: 'Editor View' })).toBeTruthy()
  expect(tab('Content').getAttribute('aria-selected')).toBe('true')
  expect(tab('Preview').getAttribute('aria-selected')).toBe('false')
  // roving tabindex: only the active tab is in the tab order
  expect(tab('Content').getAttribute('tabindex')).toBe('0')
  expect(tab('Preview').getAttribute('tabindex')).toBe('-1')
  expect(tab('Content').getAttribute('aria-controls')).toBe(panel('Content').id)
  expect(panel('Content').getAttribute('aria-labelledby')).toBe(tab('Content').id)
})

test('switching tabs shows one pane and hides the other', async () => {
  const user = userEvent.setup()
  render(<Frame />)

  expect(panel('Content').hasAttribute('hidden')).toBe(false)
  expect(panel('Preview').hasAttribute('hidden')).toBe(true)

  await user.click(tab('Preview'))

  expect(panel('Preview').hasAttribute('hidden')).toBe(false)
  expect(panel('Content').hasAttribute('hidden')).toBe(true)
  expect(tab('Preview').getAttribute('aria-selected')).toBe('true')
})

test('the hidden pane is display:none by class, not only by the hidden attribute', async () => {
  const user = userEvent.setup()
  render(<Frame />)

  await user.click(tab('Preview'))
  // a bare `hidden` attribute loses to Tailwind's `flex` class, so the class has to flip too
  expect(panel('Content').classList.contains('hidden')).toBe(true)
  expect(panel('Content').classList.contains('flex')).toBe(false)
  expect(panel('Preview').classList.contains('flex')).toBe(true)
})

test('the content pane is never remounted when tabs change', async () => {
  const user = userEvent.setup()
  render(<Frame />)
  expect(mounts).toBe(1)

  await user.click(tab('Preview'))
  await user.click(tab('Content'))
  await user.click(tab('Preview'))

  // remounting would destroy the GrapesJS editor and its undo history
  expect(mounts).toBe(1)
  expect(screen.getByText('the canvas')).toBeTruthy()
})

test('arrow keys, Home and End move and activate the tabs', async () => {
  const user = userEvent.setup()
  render(<Frame />)

  tab('Content').focus()
  await user.keyboard('{ArrowRight}')
  expect(tab('Preview').getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(tab('Preview'))

  await user.keyboard('{ArrowRight}') // wraps
  expect(tab('Content').getAttribute('aria-selected')).toBe('true')

  await user.keyboard('{End}')
  expect(tab('Preview').getAttribute('aria-selected')).toBe('true')

  await user.keyboard('{Home}')
  expect(tab('Content').getAttribute('aria-selected')).toBe('true')

  await user.keyboard('{ArrowLeft}') // wraps backwards
  expect(tab('Preview').getAttribute('aria-selected')).toBe('true')
})

test('the optional slots render only when given', () => {
  const { unmount } = render(<Frame />)
  expect(screen.queryByText('save here')).toBeNull()
  expect(screen.queryByRole('navigation', { name: 'Campaign Steps' })).toBeNull()
  unmount()

  render(
    <Frame
      topBarEnd={<button type="button">save here</button>}
      tabBarEnd={<span>pills here</span>}
      footer={<p>footer here</p>}
      wizard={{ steps: [{ label: 'Audience' }, { label: 'Template' }], currentIndex: 1 }}
    />,
  )
  expect(screen.getByRole('button', { name: 'save here' })).toBeTruthy()
  expect(screen.getByText('pills here')).toBeTruthy()
  expect(screen.getByText('footer here')).toBeTruthy()
  expect(screen.getByRole('navigation', { name: 'Campaign Steps' })).toBeTruthy()
})

test('a window under 1024px gets a message instead of the frame', () => {
  setViewport(1000)
  render(<Frame />)

  expect(screen.getByText('The template editor needs a wider window. Widen it to at least 1024 px to continue.')).toBeTruthy()
  expect(screen.queryByRole('tablist')).toBeNull()
  expect(screen.getByRole('link', { name: 'Back to Templates' })).toBeTruthy()
})

test('a window at 1024px gets the full frame', () => {
  setViewport(1024)
  render(<Frame />)

  expect(screen.getByRole('tablist', { name: 'Editor View' })).toBeTruthy()
})
