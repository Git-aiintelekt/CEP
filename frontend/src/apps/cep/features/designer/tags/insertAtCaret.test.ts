import { expect, test, vi } from 'vitest'

import { captureCaret, insertAtCaret, spliceText } from './insertAtCaret'

/** An editable holding one text node, with the selection placed by character offsets. */
function editable(text: string, start: number, end = start) {
  document.body.innerHTML = ''
  const el = document.createElement('div')
  el.contentEditable = 'true'
  el.tabIndex = -1 // a browser focuses a contentEditable on its own; jsdom needs to be told it is focusable
  el.textContent = text
  document.body.appendChild(el)
  const node = el.firstChild as Text
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, end)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return el
}

const target = (el: HTMLElement) => ({ window, editable: el, range: captureCaret(document)! })

const caretOffset = () => {
  const range = document.getSelection()!.getRangeAt(0)
  // the caret sits in whichever text node follows the inserted one: report it as a plain text position
  const before = document.createRange()
  before.setStart(range.startContainer.parentElement!, 0)
  before.setEnd(range.startContainer, range.startOffset)
  return before.toString().length
}

test('captures a copy of the selection, so the live one can change without losing it', () => {
  const el = editable('Hello world', 5)
  const saved = captureCaret(document)!
  document.getSelection()!.removeAllRanges()
  expect(saved.startOffset).toBe(5)
  expect(el.contains(saved.startContainer)).toBe(true)
})

test('captures null when nothing is selected', () => {
  editable('Hello', 1)
  document.getSelection()!.removeAllRanges()
  expect(captureCaret(document)).toBeNull()
})

test('the tag lands where the caret was: start, middle, end', () => {
  for (const [at, expected] of [[0, '{{x}}Hello world'], [5, 'Hello{{x}} world'], [11, 'Hello world{{x}}']] as const) {
    const el = editable('Hello world', at)
    expect(insertAtCaret(target(el), '{{x}}')).toBe(true)
    expect(el.textContent).toBe(expected)
  }
})

test('a selection is replaced, not added to', () => {
  const el = editable('Hello world', 0, 5)
  insertAtCaret(target(el), '{{first_name}}')
  expect(el.textContent).toBe('{{first_name}} world')
})

test('the caret ends up just after the tag, so typing carries on from there', () => {
  const el = editable('Hello world', 5)
  insertAtCaret(target(el), '{{x}}')
  expect(caretOffset()).toBe('Hello{{x}}'.length)
  expect(document.getSelection()!.isCollapsed).toBe(true)
})

test('the saved range is used even when the live selection has moved on', () => {
  const el = editable('Hello world', 5)
  const saved = captureCaret(document)!
  // what a search box in another document does to the live selection here: nothing, but be sure
  const elsewhere = document.createRange()
  elsewhere.setStart(el.firstChild!, 0)
  elsewhere.collapse(true)
  document.getSelection()!.removeAllRanges()
  document.getSelection()!.addRange(elsewhere)
  insertAtCaret({ window, editable: el, range: saved }, '{{x}}')
  expect(el.textContent).toBe('Hello{{x}} world')
})

test('the editable is told it changed, and is focused', () => {
  const el = editable('Hello', 2)
  const heard = vi.fn()
  el.addEventListener('input', heard)
  insertAtCaret(target(el), '{{x}}')
  expect(heard).toHaveBeenCalledTimes(1)
  const event = heard.mock.calls[0][0] as InputEvent
  expect(event.inputType).toBe('insertText')
  expect(event.data).toBe('{{x}}')
  expect(document.activeElement).toBe(el)
})

test('a range left behind by a re-rendered editable is refused rather than inserted blindly', () => {
  const el = editable('Hello', 2)
  const saved = captureCaret(document)!
  const fresh = document.createElement('div')
  fresh.contentEditable = 'true'
  fresh.textContent = 'Rendered again'
  el.replaceWith(fresh) // the range still points into the old, detached tree
  expect(insertAtCaret({ window, editable: fresh, range: saved }, '{{x}}')).toBe(false)
  expect(fresh.textContent).toBe('Rendered again')
})

test('a range from some other element is refused too', () => {
  const other = document.createElement('div')
  document.body.appendChild(other)
  const el = editable('Hello', 2)
  expect(insertAtCaret({ window, editable: other, range: captureCaret(document)! }, '{{x}}')).toBe(false)
  expect(el.textContent).toBe('Hello')
})

test('a live range follows an edit made underneath it, and the insert still lands inside the editable', () => {
  const el = editable('Hello', 2)
  const saved = captureCaret(document)!
  el.textContent = 'Replaced' // the text node the range sat in is removed: the range moves to its parent
  expect(insertAtCaret({ window, editable: el, range: saved }, '{{x}}')).toBe(true)
  expect(el.textContent).toBe('{{x}}Replaced')
})

test('spliceText does for an input what the range does for the canvas', () => {
  expect(spliceText('Hello world', 0, 0, '{{x}}')).toEqual({ value: '{{x}}Hello world', caret: 5 })
  expect(spliceText('Hello world', 5, 5, '{{x}}')).toEqual({ value: 'Hello{{x}} world', caret: 10 })
  expect(spliceText('Hello world', 11, 11, '{{x}}')).toEqual({ value: 'Hello world{{x}}', caret: 16 })
  expect(spliceText('Hello world', 0, 5, '{{x}}')).toEqual({ value: '{{x}} world', caret: 5 })
  // a backwards selection is still a selection
  expect(spliceText('Hello world', 5, 0, '{{x}}')).toEqual({ value: '{{x}} world', caret: 5 })
})
