/**
 * Putting a tag where the caret was, in a contentEditable that lives in another document.
 *
 * The canvas is an iframe. Its selection survives focus moving to a popover in the parent document — even one
 * that is typed into — so the range is captured when the picker opens and restored when a tag is chosen.
 * What does not survive is execCommand / rte.insertHTML from out there: the browser never records the edit,
 * and the next keystroke silently puts the old text back. A plain Range insert is recorded, and stays.
 */

export interface CaretTarget {
  /** the document the editable lives in */
  window: Window
  editable: HTMLElement
  /** captured with captureCaret when the picker opened */
  range: Range
}

/** A copy of the caret or selection, or null when there is none. */
export function captureCaret(doc: Document): Range | null {
  const selection = doc.getSelection()
  return selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
}

/**
 * Replaces the saved range with `text`, leaves the caret just after it, and tells the editable it changed.
 * Refuses, and returns false, when the range no longer sits inside the editable — the block was left, or its
 * content was re-rendered underneath the caret — rather than inserting somewhere the reader did not mean.
 */
export function insertAtCaret({ window: win, editable, range }: CaretTarget, text: string): boolean {
  if (!range.startContainer.isConnected || !editable.contains(range.startContainer)) return false
  const doc = editable.ownerDocument
  const selection = doc.getSelection()
  if (selection === null) return false

  win.focus()
  editable.focus()

  const target = range.cloneRange()
  target.deleteContents()
  const node = doc.createTextNode(text)
  target.insertNode(node)
  target.setStartAfter(node)
  target.collapse(true)
  selection.removeAllRanges()
  selection.addRange(target)

  const { InputEvent: FrameInputEvent } = win as unknown as { InputEvent: typeof InputEvent }
  editable.dispatchEvent(new FrameInputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  return true
}

/** The same idea for a plain input: what its value becomes and where the caret ends up. */
export function spliceText(value: string, start: number, end: number, text: string): { value: string; caret: number } {
  const from = Math.min(start, end)
  const to = Math.max(start, end)
  return { value: value.slice(0, from) + text + value.slice(to), caret: from + text.length }
}
