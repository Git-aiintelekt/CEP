/** What clicking an asset tile should do, given what is selected on the canvas. Pure: no GrapesJS, no React. */
export type AssetAction = 'apply' | 'insert'

export const IMAGE_KIND = 'mj-image'

export const APPLIED_MESSAGE = 'Image applied.'
export const ADDED_MESSAGE = 'Image added.'

/** An image already on the canvas gets the new picture; anything else means a new Image block. */
export function assetAction(selectedKind: string | null | undefined): AssetAction {
  return selectedKind === IMAGE_KIND ? 'apply' : 'insert'
}

export function assetMessage(action: AssetAction): string {
  return action === 'apply' ? APPLIED_MESSAGE : ADDED_MESSAGE
}

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

/** The file input carries an accept list, but a drop or a stubborn file picker can still hand over anything. */
export function acceptedImages(files: readonly File[]): File[] {
  return files.filter((file) => (ACCEPTED_TYPES as readonly string[]).includes(file.type))
}

/**
 * An address an inbox can fetch. A stored design outlives the page it was made on, and an email is read
 * somewhere else entirely, so a site-relative asset path is resolved against the app before it is written in.
 */
export function absoluteUrl(url: string, base: string = window.location.href): string {
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}
