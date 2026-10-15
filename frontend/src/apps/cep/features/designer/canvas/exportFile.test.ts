import { expect, test, vi } from 'vitest'

import { downloadText, downloadedToast, fileNameFor, kilobytes } from './exportFile'

test('the file is named after the template, with the existing sanitising rule', () => {
  expect(fileNameFor('Spring loyalty refresh', 'html')).toBe('Spring-loyalty-refresh.html')
  expect(fileNameFor('  //weird: name?! ', 'html')).toBe('weird-name.html')
  expect(fileNameFor('', 'html')).toBe('email.html')
  expect(fileNameFor('v1.2 final', 'html')).toBe('v1.2-final.html')
})

test('the size is whole kilobytes and never zero', () => {
  expect(kilobytes('x')).toBe(1)
  expect(kilobytes('a'.repeat(2048))).toBe(2)
})

test('the toast names the file and its size, in the design words', () => {
  expect(downloadedToast('Spring.html', 'a'.repeat(3000))).toEqual(['HTML downloaded', 'Spring.html · 3 KB'])
})

test('downloading hands the browser an HTML blob under that name', () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  downloadText('<p>x</p>', 'a.html')
  expect(create).toHaveBeenCalledTimes(1)
  expect((create.mock.calls[0][0] as Blob).type).toBe('text/html')
  expect(click).toHaveBeenCalledTimes(1)
  expect(revoke).toHaveBeenCalledWith('blob:x')
  click.mockRestore(); create.mockRestore(); revoke.mockRestore()
})
