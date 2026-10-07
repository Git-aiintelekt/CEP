/** Who a test goes to, and what a test send answered: shared by the campaign's test box and the drip's Send a Test card. */
import { useState } from 'react'

import type { Campaign, TestPublishResult } from '@/lib/types'

import { isText } from './vocabulary'

export type TestRow = TestPublishResult['results'][number]
/** a drip's test answers per message ({messages: [{position, status, error, results}]}): one list of rows either way */
export type DripTestAnswer = { messages: { step?: string; position: number; status?: 'SENT' | 'FAILED'; error: string | null; results: TestRow[] }[] }
export function rowsOf(answer: TestPublishResult | DripTestAnswer): TestRow[] {
  if (!('messages' in answer)) return answer.results
  return answer.messages.flatMap((message) => (message.results.length > 0 ? message.results : [{ to: `Message ${message.position}`, ok: false, detail: message.error }]))
}

/** who a test goes to: the workspace people ticked and the addresses (or numbers) typed; shared by every test form */
export function useTestRecipients(campaign: Campaign, defaultTo = '') {
  const texts = isText(campaign)
  const [to, setTo] = useState(texts ? '' : defaultTo)
  const [userIds, setUserIds] = useState<string[]>([])
  const body = () => ({ to: to.split(/[\s,;]+/).filter(Boolean), user_ids: userIds })
  return { texts, to, setTo, userIds, setUserIds, body, chosen: to.trim() !== '' || userIds.length > 0 }
}
export type TestRecipients = ReturnType<typeof useTestRecipients>

