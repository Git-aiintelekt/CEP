import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { AssetsPanel, EMPTY_NOTE } from './AssetsPanel'

afterEach(cleanup)

const ASSETS = [
  { url: 'https://cdn.example/logo.png', name: 'logo.png' },
  { url: 'https://cdn.example/hero.jpg', name: 'hero.jpg' },
]

function renderPanel(over: Partial<React.ComponentProps<typeof AssetsPanel>> = {}) {
  const onUpload = vi.fn()
  const onUse = vi.fn()
  const result = render(<AssetsPanel assets={ASSETS} onUpload={onUpload} onUse={onUse} {...over} />)
  return { onUpload, onUse, ...result }
}

const tile = (name: string) => screen.getByRole('button', { name })
const fileInput = () => document.querySelector('input[type=file]') as HTMLInputElement
const file = (name: string, type: string) => new File(['x'], name, { type })

test('every asset gets a tile a reader can name, with the picture itself unlabelled', () => {
  renderPanel()

  for (const asset of ASSETS) {
    const button = tile(asset.name)
    const image = button.querySelector('img') as HTMLImageElement
    expect(image.getAttribute('src')).toBe(asset.url)
    expect(image.getAttribute('alt')).toBe('') // the file name below is already the accessible name
    expect(button.querySelector('span')?.getAttribute('title')).toBe(asset.name)
  }
  expect(screen.queryByText(EMPTY_NOTE)).toBeNull()
})

test('an empty library says what to do about it', () => {
  renderPanel({ assets: [] })
  expect(screen.getByText(EMPTY_NOTE)).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
})

test('clicking a tile uses that asset', async () => {
  const user = userEvent.setup()
  const { onUse } = renderPanel()

  await user.click(tile('hero.jpg'))
  expect(onUse).toHaveBeenCalledWith(ASSETS[1])
})

test('the upload button opens the hidden input, which accepts only the image types', async () => {
  const user = userEvent.setup()
  renderPanel()

  const input = fileInput()
  expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp')
  expect(input.multiple).toBe(true)

  const click = vi.spyOn(input, 'click')
  await user.click(screen.getByRole('button', { name: 'Upload Image' }))
  expect(click).toHaveBeenCalled()
})

test('choosing files reports only the accepted ones', () => {
  const { onUpload } = renderPanel()

  fireEvent.change(fileInput(), { target: { files: [file('a.png', 'image/png'), file('b.pdf', 'application/pdf')] } })
  expect(onUpload).toHaveBeenCalledTimes(1)
  expect(onUpload.mock.calls[0][0].map((item: File) => item.name)).toEqual(['a.png'])
})

test('the input is cleared after a pick, so the same file can be chosen again after a failure', () => {
  renderPanel()
  const input = fileInput()
  // jsdom reports '' for a file input whatever happens, so the write itself is what gets watched
  const cleared = vi.fn()
  Object.defineProperty(input, 'value', { get: () => '', set: cleared, configurable: true })

  fireEvent.change(input, { target: { files: [file('a.png', 'image/png')] } })
  expect(cleared).toHaveBeenCalledWith('')
})

test('choosing nothing acceptable reports nothing at all', () => {
  const { onUpload } = renderPanel()
  fireEvent.change(fileInput(), { target: { files: [file('a.svg', 'image/svg+xml')] } })
  expect(onUpload).not.toHaveBeenCalled()
})

test('a file still going up shows as a placeholder, not a tile', () => {
  renderPanel({ uploading: ['new.png'] })

  expect(screen.getByTitle('new.png')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'new.png' })).toBeNull()
  expect(screen.getAllByRole('button', { name: /\.(png|jpg)$/ })).toHaveLength(ASSETS.length)
})

test('an upload into an empty library replaces the empty state', () => {
  renderPanel({ assets: [], uploading: ['new.png'] })
  expect(screen.queryByText(EMPTY_NOTE)).toBeNull()
  expect(screen.getByTitle('new.png')).toBeTruthy()
})

test('the message is announced politely and is empty when there is none', () => {
  const { rerender } = renderPanel()
  expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
  expect(screen.getByRole('status').textContent).toBe('')

  rerender(<AssetsPanel assets={ASSETS} onUpload={vi.fn()} onUse={vi.fn()} message="logo.png uploaded." />)
  expect(screen.getByRole('status').textContent).toBe('logo.png uploaded.')
})

test('a thumbnail that fails to load falls back to a neutral tile, keeping the name', () => {
  renderPanel()

  const button = tile('logo.png')
  fireEvent.error(button.querySelector('img') as HTMLImageElement)
  expect(button.querySelector('img')).toBeNull()
  expect(button.querySelector('svg')).toBeTruthy()
  expect(tile('logo.png')).toBeTruthy()
})

test('read-only greys everything out, keeps it focusable, and does nothing', async () => {
  const user = userEvent.setup()
  const { onUse, onUpload } = renderPanel({ disabled: true })

  const upload = screen.getByRole('button', { name: 'Upload Image' })
  const image = tile('logo.png')
  for (const control of [upload, image]) {
    expect(control.getAttribute('aria-disabled')).toBe('true')
    expect(control.hasAttribute('disabled')).toBe(false)
    expect(control.className).toContain('bg-fill-subtle')
    expect(control.className).not.toContain('opacity')
  }

  const click = vi.spyOn(fileInput(), 'click')
  await user.click(upload)
  await user.click(image)
  expect(click).not.toHaveBeenCalled()
  expect(onUse).not.toHaveBeenCalled()
  expect(onUpload).not.toHaveBeenCalled()

  image.focus()
  expect(document.activeElement).toBe(image)
})
