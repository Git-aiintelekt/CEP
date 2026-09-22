/** Which template editor route a channel opens: E_RECEIPT gets its own editor, EMAIL the drag-and-drop designer, everything else (SMS/MMS) the message editor. */
export function editorRouteFor(channel: string): 'design' | 'receipt' | 'message' {
  if (channel === 'E_RECEIPT') return 'receipt'
  if (channel === 'EMAIL') return 'design'
  return 'message'
}
