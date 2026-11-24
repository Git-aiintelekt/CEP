/**
 * The line under a text template's part counter: what one recipient costs at the workspace's default sender's price, updating as
 * the message is typed. SMS: parts × (price a part + carrier fee). MMS: one flat price. WhatsApp: the price of the template's
 * category in the home country. Nothing for people without View Message Costs, or before the platform team sets prices.
 */
import { textCostLine } from './data'
import { costMoney, unitMoney, useMessagePrices, useSeesCosts } from './money'

const PER_THOUSAND = 1000

/** SMS and MMS: under the part counter */
export function TextCostLine({ channel, segments, unicode }: { channel: 'SMS' | 'MMS'; segments: number; unicode?: boolean }) {
  const sees = useSeesCosts()
  const prices = useMessagePrices()
  const line = sees ? textCostLine(prices.data, channel, segments) : null
  if (!line) return null
  return (
    <div className="mt-2 rounded-sm border border-line-subtle bg-surface-subtle px-3 py-2" data-cost-line>
      <p className="cep-num text-sm font-semibold text-ink-900">{line.headline}</p>
      <p className="cep-num text-helper text-ink-800">
        {line.detail}
        {channel === 'SMS' && unicode && ' An emoji or other special character makes every part shorter (70 characters, 67 when longer).'}
        {' '}Tags are counted with their sample values: a long value can add a part.
      </p>
    </div>
  )
}

/** WhatsApp: the price depends on the template's category and the country, not on the text */
export function WhatsAppCostLine({ category }: { category: string }) {
  const sees = useSeesCosts()
  const prices = useMessagePrices()
  const wa = sees ? prices.data?.whatsapp : null
  if (!wa) return null
  const key = (category || 'MARKETING').toLowerCase() as 'marketing' | 'utility' | 'authentication'
  const price = wa.prices[key]
  if (!price?.home) return null
  const currency = prices.data?.currency
  const home = Number(price.home)
  return (
    <div className="mt-2 rounded-sm border border-line-subtle bg-surface-subtle px-3 py-2" data-cost-line>
      <p className="cep-num text-sm font-semibold text-ink-900">
        {key === 'utility' ? 'Up to ' : ''}{unitMoney(home, currency)} a delivered message to {wa.home_name} numbers · {costMoney(home * PER_THOUSAND, currency)} per 1,000
      </p>
      <p className="cep-num text-helper text-ink-800">
        {price.others_max ? `Other countries up to ${unitMoney(price.others_max, currency)}. ` : ''}
        {key === 'utility' ? 'Free when the customer wrote to you in the last 24 hours. ' : ''}
        Any length, with or without the picture. Messages that are not delivered cost nothing.
      </p>
    </div>
  )
}
