/** Images for Ask for a Report: which files are taken, and a large one scaled down in the browser before it is sent (the server
 * takes at most 3 images of up to 3.75 MB each, PNG, JPEG, GIF or WebP; apps/insights/assistant.py read_images). */

export const IMAGES_MAX = 3
export const IMAGE_BYTES_MAX = 3_750_000
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
/** the long side the providers read at full detail; anything larger is scaled down to it */
const LONG_SIDE = 1568

export function isImage(file: File): boolean {
  return IMAGE_TYPES.includes(file.type)
}

/** The image as it will be sent: itself when it is small enough, else redrawn at most LONG_SIDE on its long side (a JPEG stays a
 * JPEG, anything else becomes a PNG). Where the browser cannot redraw it, the original goes and the server's limit decides. */
export async function shrink(file: File): Promise<File> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, LONG_SIDE / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size <= IMAGE_BYTES_MAX) {
      bitmap.close()
      return file
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9))
    if (!blob) return file
    const name = file.name.replace(/\.[^.]+$/, '') + (type === 'image/jpeg' ? '.jpg' : '.png')
    return new File([blob], name, { type })
  } catch {
    return file
  }
}
