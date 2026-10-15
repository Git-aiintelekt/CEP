/**
 * A plain check of a subject line against what spam filters weigh: known trigger words and phrases, shouting in
 * capitals, and stacked punctuation. Advice, not a verdict: filters score the whole message and the sender's record.
 */

const PHRASES = [
  'free', 'free money', 'winner', 'you have won', 'you won', 'congratulations', 'act now', 'urgent', 'limited time', 'last chance', 'don’t miss', "don't miss", 'buy now',
  'click here', 'click below', 'order now', 'guarantee', 'guaranteed', 'risk-free', 'no obligation', 'no cost', '100%', 'cash', 'earn money', 'make money', 'double your',
  'cheap', 'lowest price', 'best price', 'bargain', 'discount!!!', 'save big', 'prize', 'bonus', 'miracle', 'amazing', 'incredible deal', 'once in a lifetime', 'apply now',
  'call now', 'dear friend', 'this isn’t spam', 'this is not spam', 'not spam', 'unsubscribe now', 'viagra', 'casino', 'lottery', 'credit card', 'loan', 'debt', 'refinance',
  'weight loss', 'lose weight', 'work from home', 'be your own boss', 'get paid', 'income', 'investment', 'crypto', 'bitcoin', 'free gift', 'free trial', 'sign up free',
  '$$$', '!!!', 'open immediately', 'time sensitive', 'exclusive deal', 'special promotion', 'offer expires', 'expires today', 'now only', 'while supplies last',
]

export interface SpamCheck {
  /** the trigger words and phrases found, as they appear in the list */
  words: string[]
  /** every letter is a capital, over a handful of them */
  shouting: boolean
  /** two or more ! or ? in a row, or more than one ! */
  punctuation: boolean
  /** the rating: 0 nothing, 1 a little, 2 several things */
  level: 0 | 1 | 2
}

export function checkSpam(subject: string): SpamCheck {
  const text = subject.trim()
  const lower = text.toLowerCase()
  const words = PHRASES.filter((phrase) => {
    if (/^[a-z]/.test(phrase) && /[a-z0-9]$/.test(phrase)) return new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(lower)
    return lower.includes(phrase)
  })
  const letters = text.replace(/[^A-Za-z]/g, '')
  const shouting = letters.length >= 6 && letters === letters.toUpperCase()
  const punctuation = /[!?]{2,}/.test(text) || (text.match(/!/g) ?? []).length > 1
  const score = words.length + (shouting ? 1 : 0) + (punctuation ? 1 : 0)
  return { words, shouting, punctuation, level: score === 0 ? 0 : score === 1 ? 1 : 2 }
}

/** One sentence for the note under the subject, or null when there is nothing to say. */
export function spamHint(subject: string): string | null {
  const check = checkSpam(subject)
  if (check.level === 0) return null
  const parts: string[] = []
  if (check.words.length) parts.push(`${check.words.length === 1 ? 'a word' : 'words'} filters weigh: ${check.words.slice(0, 3).map((word) => `“${word}”`).join(', ')}${check.words.length > 3 ? '…' : ''}`)
  if (check.shouting) parts.push('all capitals')
  if (check.punctuation) parts.push('stacked punctuation')
  return `${check.level === 2 ? 'Spam risk' : 'Spam check'}: ${parts.join('; ')}. Filters score the whole message, but a plainer subject lands more often.`
}
