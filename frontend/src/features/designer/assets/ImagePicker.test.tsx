import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { EMPTY_NOTE } from './AssetGrid'
import { ImagePicker, PICKER_CANCEL, PICKER_HELP, PICKER_TITLE } from './ImagePicker'

afterEach(cleanup)

const assets = [
  { url: 'https://cdn.example.com/fall-hero.jpg', name: 'fall-hero.jpg' },
  { url: 'https://cdn.example.com/winter.png', name: 'winter.png' },
]

function renderPicker(over: Partial<React.ComponentProps<typeof ImagePicker>> = {}) {
  const onChoose = vi.fn()
  const onClose = vi.fn()
  const onUpload = vi.fn()
  render(<ImagePicker assets={assets} onChoose={onChoose} onClose={onClose} onUpload={onUpload} {...over} />)
  return { onChoose, onClose, onUpload }
}

test('the dialog says what it is for and offers both routes to a picture', () => {
  renderPicker()
  expect(screen.getByRole('dialog', { name: PICKER_TITLE })).toBeTruthy()
  expect(screen.getByText(PICKER_HELP)).toBeTruthy()
  expect(screen.getByRole('button', { name: /upload image/i })).toBeTruthy()
  expect(screen.getByRole('button', { name: /fall-hero\.jpg/ })).toBeTruthy()
})

test('picking an image hands it back once, and does not close by itself', async () => {
  const user = userEvent.setup()
  const { onChoose, onClose } = renderPicker()

  await user.click(screen.getByRole('button', { name: /winter\.png/ }))
  expect(onChoose).toHaveBeenCalledTimes(1)
  expect(onChoose.mock.calls[0][0].name).toBe('winter.png')
  expect(onClose).not.toHaveBeenCalled()
})

test('an empty library still offers the upload, and says there is nothing yet', () => {
  renderPicker({ assets: [] })
  expect(screen.getByText(EMPTY_NOTE)).toBeTruthy()
  expect(screen.getByRole('button', { name: /upload image/i })).toBeTruthy()
})

test('a file going up shows while the dialog stays open', () => {
  renderPicker({ assets: [], uploading: ['fall-hero.jpg'] })
  expect(screen.queryByText(EMPTY_NOTE)).toBeNull()
  expect(screen.getByTitle('fall-hero.jpg')).toBeTruthy()
})

test('cancel and Escape both leave without choosing anything', async () => {
  const user = userEvent.setup()
  const { onChoose, onClose } = renderPicker()

  await user.click(screen.getByRole('button', { name: PICKER_CANCEL }))
  expect(onClose).toHaveBeenCalledTimes(1)

  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(2)
  expect(onChoose).not.toHaveBeenCalled()
})

test('an image in the dialog is chosen, never carried: there is nowhere in a dialog to drop it', async () => {
  const user = userEvent.setup()
  const { onChoose } = renderPicker()

  const tile = screen.getByRole('button', { name: /fall-hero\.jpg/ })
  expect(tile.className).not.toContain('touch-action')
  await user.click(tile)
  expect(onChoose).toHaveBeenCalledTimes(1)
})
