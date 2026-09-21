import { expect, test } from 'vitest'

import { ADDED_MESSAGE, APPLIED_MESSAGE, absoluteUrl, acceptedImages, assetAction, assetMessage } from './assetAction'

const file = (name: string, type: string) => new File(['x'], name, { type })

test('an image selected on the canvas takes the new picture', () => {
  expect(assetAction('mj-image')).toBe('apply')
  expect(assetMessage('apply')).toBe(APPLIED_MESSAGE)
})

test('anything else means a new Image block', () => {
  for (const kind of ['mj-text', 'mj-section', 'mj-column', 'mj-button', '', null, undefined]) {
    expect(assetAction(kind), String(kind)).toBe('insert')
  }
  expect(assetMessage('insert')).toBe(ADDED_MESSAGE)
})

test('only the image types the input accepts get through', () => {
  const chosen = acceptedImages([
    file('a.png', 'image/png'),
    file('b.jpg', 'image/jpeg'),
    file('c.gif', 'image/gif'),
    file('d.webp', 'image/webp'),
    file('e.svg', 'image/svg+xml'),
    file('f.pdf', 'application/pdf'),
    file('g.txt', ''),
  ])
  expect(chosen.map((item) => item.name)).toEqual(['a.png', 'b.jpg', 'c.gif', 'd.webp'])
})

test('nothing acceptable gives an empty list rather than a surprise', () => {
  expect(acceptedImages([])).toEqual([])
  expect(acceptedImages([file('a.svg', 'image/svg+xml')])).toEqual([])
})




test('a site-relative address becomes one an inbox can fetch', () => {
  expect(absoluteUrl('/media/fall-hero.jpg', 'https://app.example.com/templates/7/design')).toBe('https://app.example.com/media/fall-hero.jpg')
})

test('an address that is already absolute is left alone', () => {
  const url = 'https://cdn.example.com/media/fall-hero.jpg'
  expect(absoluteUrl(url, 'https://app.example.com/')).toBe(url)
})
