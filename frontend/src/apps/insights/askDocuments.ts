/** Documents for Ask for a Report: a report's spec as a PDF, a Word file (.docx), text or Markdown (the server takes at most 3, up to
 * 10 MB each, and 20 MB of documents and images together; apps/insights/ask_documents.py read_documents). */

export const DOCUMENTS_MAX = 3
export const DOCUMENT_BYTES_MAX = 10_000_000
export const ATTACHMENTS_BYTES_MAX = 20_000_000
export const DOCUMENT_ACCEPT = ['.pdf', '.docx', '.txt', '.md', '.markdown', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown']

export type DocumentKind = 'pdf' | 'word' | 'text' | 'markdown'
export const KIND_LABEL: Record<DocumentKind, string> = { pdf: 'PDF', word: 'Word', text: 'Text', markdown: 'Markdown' }

/** what a file is taken as, by its name first (a browser often gives Markdown no type), else null */
export function documentKind(file: File): DocumentKind | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf'
  if (name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'word'
  if (name.endsWith('.md') || name.endsWith('.markdown') || file.type === 'text/markdown') return 'markdown'
  if (name.endsWith('.txt') || file.type === 'text/plain') return 'text'
  return null
}

export function sizeWords(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`
}
