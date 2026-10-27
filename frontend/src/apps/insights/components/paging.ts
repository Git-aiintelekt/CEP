export const PAGE_SIZES = [20, 50, 100] as const

/** rows per page as this browser last chose it, under key */
export function rememberedSize(key: string): number {
  try {
    const stored = Number(window.localStorage.getItem(key))
    return (PAGE_SIZES as readonly number[]).includes(stored) ? stored : PAGE_SIZES[0]
  } catch {
    return PAGE_SIZES[0]
  }
}
