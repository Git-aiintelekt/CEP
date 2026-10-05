/** Local calendar dates as "YYYY-MM-DD" and half-hour times as "HH:MM", for DatePicker and TimePicker. */

const fieldText = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export function toDateValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function fromDateValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** "Dec 25, 2026" */
export function formatDateValue(value: string): string {
  const date = fromDateValue(value)
  return date ? fieldText.format(date) : ''
}

export const HALF_HOURS = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2)
  const minute = index % 2 === 0 ? '00' : '30'
  return { value: `${String(hour).padStart(2, '0')}:${minute}`, label: `${((hour + 11) % 12) + 1}:${minute} ${hour < 12 ? 'AM' : 'PM'}` }
})

export const timeLabel = (value: string) => HALF_HOURS.find((slot) => slot.value === value)?.label ?? ''
