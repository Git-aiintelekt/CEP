/** A warm-up as the API returns it: City HT's dedicated IP on a daily plan for 25,000 contacts, day 9 of 15, day 10 offered for
 * approval. For the mock API and the tests. */
import type { WarmUpDay, WarmUpOverview, WarmUpPlanDay, WarmUpPlans } from '@/lib/types'

const SCHEDULE = [20, 28, 39, 55, 77, 108, 151, 211, 295, 413, 579, 810, 1000, 1587, 2222]

function planOf(start: number, hours: number, contacts: number): WarmUpPlanDay[] {
  const days: WarmUpPlanDay[] = []
  for (let age = start; age < SCHEDULE.length; age++) {
    const last = SCHEDULE[age] * hours >= contacts
    const hourly = last ? Math.ceil(contacts / hours) : SCHEDULE[age]
    days.push({ day: days.length + 1, age, hourly, daily: hourly * hours })
    if (last) break
  }
  return days
}

export const SAMPLE_WARM_UP_PLANS: WarmUpPlans = {
  contacts_target: 25000,
  plan_name: 'Growth',
  plans: { DEDICATED_HOURLY: planOf(0, 24, 25000), DEDICATED_DAILY: planOf(0, 13, 25000), SHARED_HOURLY: planOf(7, 24, 25000), SHARED_DAILY: planOf(7, 13, 25000) },
}

const MEMBERS = { id: 'l1', name: 'Members – Active', member_count: 9800 }
const NEWSLETTER = { id: 'l2', name: 'Newsletter', member_count: 12400 }

function day(plan: WarmUpPlanDay, current: number): WarmUpDay {
  const done = plan.day < current
  const template = plan.day <= 4 ? { id: 't1', name: 'Welcome to City HT News' } : { id: 't2', name: 'Weekend Offer Preview' }
  return {
    day: plan.day, age: plan.age, hourly_limit: plan.hourly, daily_limit: plan.daily, date: `2026-11-${String(plan.day - current + 5).padStart(2, '0')}`,
    state: done ? 'DONE' : plan.day === current ? 'TODAY' : 'PLANNED', lists: plan.day <= 4 ? [MEMBERS] : [MEMBERS, NEWSLETTER], template,
    sent: done ? plan.daily : plan.day === current ? 1691 : 0, opened: done ? Math.round(plan.daily * 0.4) : plan.day === current ? 575 : 0, waiting: 0,
    health: done ? { sent: plan.daily, bounced: 3, complained: 0, outcome: 'DONE' } : null,
    campaigns: done || plan.day === current ? [{ id: `wc${plan.day}`, name: `Day ${plan.day} · ${template.name}`, status: done ? 'COMPLETED' : 'ACTIVE', sent_on: '2026-11-05' }] : [],
  }
}

const DAYS = SAMPLE_WARM_UP_PLANS.plans.DEDICATED_DAILY

export const SAMPLE_WARM_UP: WarmUpOverview = {
  present: true,
  contacts_target: 25000,
  plan_name: 'Growth',
  warmup: {
    id: 'w1', status: 'WARMING', status_note: null, ip_mode: 'DEDICATED', plan_kind: 'DAILY', window_start: '08:00', window_end: '21:00', window_hours: 13,
    advance_mode: 'APPROVE', current_day: 9, days_total: DAYS.length, offered_day: 10, round: 1, contacts_target: 25000, extra_template_ids: [],
    sender: { id: 's1', display_name: 'City HT', from_address: 'news@news.cityht.com.sg' }, started_at: '2026-10-28T00:00:00Z', finished_at: null, time_zone: 'Asia/Singapore',
    today: { date: '2026-11-05', hour: '15:00', in_window: true, limit_hour: 413, limit_day: 5369, sent_this_hour: 210, sent: 2891, bounced: 4, complained: 0, waiting_own: 0, waiting_warm_up: 120 },
    limits: { bounce: 0.02, complaint: 0.001 },
    people: { reached: 13400, no_template: 0 },
  },
  days: DAYS.map((plan) => day(plan, 9)),
  extra_templates: [],
}

export const NO_WARM_UP: WarmUpOverview = { present: true, contacts_target: 25000, plan_name: 'Growth', warmup: null, days: [] }
