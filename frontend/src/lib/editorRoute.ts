/** Which template editor route a channel opens: E_RECEIPT gets its own editor, EMAIL the drag-and-drop designer, WHATSAPP the WhatsApp editor, everything else (SMS/MMS) the message editor. */
export function editorRouteFor(channel: string): 'design' | 'receipt' | 'message' | 'whatsapp' {
  if (channel === 'E_RECEIPT') return 'receipt'
  if (channel === 'WHATSAPP') return 'whatsapp'
  if (channel === 'EMAIL') return 'design'
  return 'message'
}

/** Where a template opens: /templates/{id}/design, /receipt, /message or /whatsapp. */
export function editorPathFor(template: { id: string; channel: string }): string {
  return `/templates/${template.id}/${editorRouteFor(template.channel)}`
}
