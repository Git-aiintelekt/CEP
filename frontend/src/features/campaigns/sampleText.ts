import { resolvedText } from '@/features/templates/preview/usePreviewContent'
import type { PersonalizationTag } from '@/lib/types'

export const SAMPLED = 'Shown with sample values'

/** the text as the thumbnail shows it, each tag filled with its sample value, and whether any tag was */
export function withSamples(text: string, tags: PersonalizationTag[]): { value: string; sampled: boolean } {
  const value = resolvedText(text, tags)
  return { value, sampled: value !== text }
}
