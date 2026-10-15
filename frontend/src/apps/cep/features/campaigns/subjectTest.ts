/** The subject line test's settings and how they read: the same defaults and limits as the send engine (engine/abtest.py). */
import type { AbConfig } from '@/lib/types'

export const AB_DEFAULTS = { sample_pct: 20, metric: 'OPEN_RATE' as const, decide_after_minutes: 240 }
export const SAMPLE_CHOICES = [10, 15, 20, 25, 30, 35, 40, 45, 50]
export const METRIC_CHOICES: { value: 'OPEN_RATE' | 'CLICK_RATE'; label: string }[] = [
  { value: 'OPEN_RATE', label: 'Open Rate' },
  { value: 'CLICK_RATE', label: 'Click Rate' },
]
export const DECIDE_CHOICES = [30, 60, 120, 240, 480, 720, 1440, 2880, 4320, 10080]

/** 240 -> "4 hours", 90 -> "90 minutes", 1440 -> "1 day" */
export function waitText(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
  return `${minutes} minutes`
}

export const metricText = (metric: string | null | undefined) => (metric === 'CLICK_RATE' ? 'click rate' : 'open rate')

/** A test is on when it is switched on and has its second subject: the engine ignores anything less. */
export function testIsOn(config: AbConfig | null | undefined): config is AbConfig & { subject_b: string } {
  return Boolean(config?.enabled && config.subject_b?.trim())
}

/** One line for the review summary: "A/B test, 20% sample, winner by open rate after 4 hours". `own`: the campaign has its own subject. */
export function testSummary(config: AbConfig | null | undefined, own = false): string {
  if (!testIsOn(config)) return own ? 'One subject line, set for this campaign' : 'One subject line, from the template'
  const sample = config.sample_pct ?? AB_DEFAULTS.sample_pct
  return `A/B test, ${sample}% sample, winner by ${metricText(config.metric ?? AB_DEFAULTS.metric)} after ${waitText(config.decide_after_minutes ?? AB_DEFAULTS.decide_after_minutes)}`
}
