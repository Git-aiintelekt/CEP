import { titleize } from '@/lib/format'

/** where a list came from, in the Contact lists page's words (the API's source_label), for answers that only carry source_type */
const SOURCE_LABEL: Record<string, string> = { UPLOAD: 'Upload', BI: 'BI / Extraction', EXTRACTION: 'BI / Extraction', SEGMENT: 'Segment', CLONE: 'Cloned' }

export const sourceLabel = (sourceType: string) => SOURCE_LABEL[sourceType] ?? titleize(sourceType)
