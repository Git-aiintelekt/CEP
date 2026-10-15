/** Handing the browser a file to save. Pure name rule, tested; the click on a link is the only DOM in here. */

/** The template's name as a file name: anything that is not a word character, dot or dash becomes a dash. */
export function fileNameFor(name: string, extension: string): string {
  const stem = name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'email'
  return `${stem}.${extension}`
}

/** Whole kilobytes, never zero for a file that has something in it. */
export function kilobytes(text: string): number {
  return Math.max(1, Math.round(new Blob([text]).size / 1024))
}

export function downloadText(text: string, fileName: string, type = 'text/html'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export const downloadedToast = (fileName: string, text: string): [string, string] => ['HTML downloaded', `${fileName} · ${kilobytes(text)} KB`]
