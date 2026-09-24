import type { PresetContent } from '@/lib/types'

/** A preset whose content the frontend owns. Keeps the key of the server starter it replaces, if there is one. */
export interface PresetDefinition {
  key: string
  name: string
  channel: 'EMAIL' | 'SMS' | 'MMS' | 'E_RECEIPT'
  category: string
  description: string
  content: PresetContent
}
