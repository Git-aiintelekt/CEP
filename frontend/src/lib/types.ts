/**
 * Hand-written types for the resources this scaffold uses. For full coverage run `npm run gen:api` with the backend
 * up: it writes src/lib/api-schema.d.ts from /api/v1/schema/ (OpenAPI), which these can then be derived from.
 */

export interface Problem {
  type?: string
  title?: string
  status?: number
  detail?: string
  errors?: Record<string, unknown>
  /** CEP's own problem (500): ER-<error group>, which the back-office Errors page finds */
  reference?: string
  /** when the server had it */
  at?: string
}

export interface TokenPair {
  access: string
  refresh: string
}

export interface Page<T> {
  next: string | null
  previous: string | null
  results: T[]
  /** GET /journeys/ only: every live journey in the workspace, ignoring the filters */
  total?: number
}

export interface Me {
  principal: {
    kind: 'user' | 'api_client'
    id?: string
    email?: string
    display_name?: string
    name?: string
    is_staff?: boolean
    is_platform_admin?: boolean
    permissions?: string[]
    scopes?: string[]
    /** the user's role names, for the header: ["Marketing Admin"] */
    roles?: string[]
  }
  tenant: { id: string; code: string; timezone: string; db_alias: string; db_status: string }
  /** industry profile of the workspace, e.g. RETAIL */
  industry?: string
  /** feature switches resolved from industry profile, workspace overrides and plan; absent = everything on */
  features?: Partial<Record<Feature, boolean>>
  /** the industry's words for generic things: { location: 'store' } */
  terminology?: Record<string, string>
  /** true while the only thing this session may do is enrol in multi-factor authentication */
  mfa_setup_required?: boolean
  /** set when platform support is acting as this user */
  support_session?: { by: string; mode: 'READ' | 'WRITE'; expires_at: string; reason?: string } | null
  /** how long the browser waits before warning of inactivity, and how long the warning stays up before signing out (global parameters) */
  session?: { idle_timeout_minutes: number; idle_warning_seconds: number }
}

export type Feature =
  | 'email' | 'sms' | 'mms' | 'ereceipt' | 'journeys' | 'ab_testing' | 'loyalty' | 'api_access' | 'webhooks' | 'sso' | 'custom_domain' | 'scoring'
  | 'dynamic_codes'

/** POST /auth/token/ answers tokens, or asks for the second factor */
export interface LoginResult extends Partial<TokenPair> {
  mfa_required?: boolean
  mfa_token?: string
  mfa_setup_required?: boolean
}

export interface AuthOptions {
  workspace: string
  sso_enabled: boolean
  sso_enforced: boolean
  sso_name: string | null
  mfa_required: boolean
}

export interface MfaStatus {
  enabled: boolean
  required: boolean
  recovery_codes_left: number
  sso: boolean
  confirmed_at: string | null
}

export interface MfaSetup {
  secret: string
  otpauth_uri: string
}

export interface UsageMeter {
  label: string
  used: number
  limit: number | null
  percent: number | null
  state: 'ok' | 'warning' | 'over' | 'blocked'
  unit: string
  overage: boolean
  overage_price_per_1k: number | null
  /** where the limit comes from, in words (deliverability tests: the plan + the tests added for the month) */
  note?: string | null
}

export interface Usage {
  month: string
  plan: { code: string; name: string; monthly_price: number; currency: string; status: string } | null
  meters: UsageMeter[]
  breakdown: Record<string, number>
  can_send: boolean
}

export interface Invoice {
  id: string
  invoice_number: string
  period_month: string
  plan_code: string
  currency: string
  base_amount: string
  overage_amount: string
  total_amount: string
  line_items: { description: string; quantity: number; unit_price: number; amount: number }[]
  status: 'ISSUED' | 'PAID' | 'VOID' | string
  issued_at: string | null
  due_at: string | null
  paid_at: string | null
}

export interface IdentityProvider {
  display_name: string
  issuer: string
  client_id: string
  has_client_secret: boolean
  scopes: string
  allowed_email_domains: string[]
  jit_provisioning: boolean
  default_role: string | null
  enforce_sso: boolean
  is_active: boolean
}

export interface SecuritySettings {
  require_mfa: boolean
  sso_available: boolean
  redirect_uri: string
  identity_provider: IdentityProvider | null
}

/** One installed delivery adapter and the inputs its form needs (GET /delivery-providers/catalogue/) */
export interface ProviderType {
  provider_type: string
  label: string
  description: string
  supports_webhooks: boolean
  /** false: created by another screen (SMTP follows Settings -> Email server) */
  manageable: boolean
  /** EMAIL, or SMS for text engines (they carry MMS too when supports_mms) */
  channel?: 'EMAIL' | 'SMS'
  supports_mms?: boolean
  /** a secret field's `credential` says which of the engine's credentials it is: the main one, or the second one for transactional traffic */
  fields: { key: string; label: string; required: boolean; secret: boolean; help: string; placeholder: string; kind: 'text' | 'url' | 'textarea'; credential?: 'secret' | 'transactional_secret' | null }[]
}

export interface DeliveryProvider {
  id: string
  provider_type: string
  channel: string
  name: string
  config: Record<string, string>
  /** the credential itself is write-only */
  has_secret: boolean
  /** a second credential for receipts and other transactional email is stored (engines that offer one) */
  has_transactional_secret?: boolean
  secret_ref: string | null
  rate_limit_per_minute: number | null
  is_default: boolean
  is_active: boolean
  /** address to register with the provider for delivery / bounce / open / click callbacks */
  webhook_url: string | null
  sender_count: number
  last_checked_at: string | null
  last_check_ok: boolean | null
  last_check_error: string | null
  /** when the engine last called the callback address, and how many times in the last 24 hours: a dead webhook reads "never" */
  last_callback_at?: string | null
  callbacks_24h?: number
  row_version: number
  manageable?: boolean
}

export interface DeliverySender extends SenderProfile {
  delivery_provider: string
}

export interface RunResults {
  id: string
  status: string
  started_at: string | null
  completed_at: string | null
  /** EMAIL or SMS (texts: SMS and MMS) */
  family?: 'EMAIL' | 'SMS'
  audience: { members: number; eligible: number; suppressed: Record<string, number> }
  messages: { queued: number; sent: number; failed: number; delivered: number; opened: number; clicked: number; bounced: number; complained: number
              /** texts only */ replied?: number; opted_out?: number; parts?: number }
  by_status: Record<string, number>
}

/** What someone texted back: STOP / START / HELP or a free reply */
export interface SmsReply {
  id: number
  from_number: string
  to_number: string | null
  body: string
  keyword: string | null
  action: 'OPT_OUT' | 'OPT_IN' | 'HELP' | 'NONE'
  party_id: string | null
  name: string | null
  campaign: string | null
  received_at: string
}

export interface SendTestResult {
  to: string
  ok: boolean
  detail: string | null
}

export interface MailServer {
  host: string
  port: number
  security: 'STARTTLS' | 'SSL' | 'NONE'
  username: string | null
  /** the password itself is write-only */
  has_password: boolean
  from_email: string
  from_name: string | null
  reply_to: string | null
  /** also offered as a campaign delivery provider + sender profile */
  campaign_sender: boolean
  is_active: boolean
  last_tested_at: string | null
  last_test_ok: boolean | null
  last_test_error: string | null
}

export interface MailServerSettings {
  server: MailServer | null
  /** what platform messages for this workspace currently go through: the workspace's own server, or the platform's until then */
  in_use: 'tenant' | 'platform' | 'environment' | 'console' | string
  /** the campaign sender profile backed by this server, when offered */
  sender_profile: { id: string; display_name: string; from_address: string; verification_status: 'PENDING' | 'VERIFIED' | 'FAILED'; is_default: boolean } | null
}

export interface SupportAccess {
  id: string
  staff: string
  as_user: string
  as_email: string
  reason: string
  mode: 'READ' | 'WRITE'
  started_at: string
  expires_at: string
  ended_at: string | null
  writes: number
}

interface Audited {
  id: string
  tenant: string
  created_at: string
  updated_at: string
  row_version: number
}

export type Channel = 'EMAIL' | 'SMS' | 'MMS' | 'E_RECEIPT' | string

export interface CampaignRun extends Audited {
  campaign: string
  run_number: number
  run_type: string
  status: string
  test_mode: boolean
  scheduled_at: string | null
  started_at: string | null
  completed_at: string | null
  /** "Occurrence 3", "Day 7", "Test": which send of a recurring or drip campaign this run is */
  sequence_label?: string | null
  /** a drip's run: the message (step id) it sends */
  drip_step?: string | null
}

export interface Campaign extends Audited {
  code: string | null
  name: string
  description: string | null
  campaign_type: string
  channel: Channel
  status: string
  status_label: string
  solicitation_type: string
  is_journey_generated: boolean
  scheduled_at: string | null
  template: string | null
  sender_profile: string | null
  origin_journey: string | null
  owner_user: string | null
  template_name: string | null
  sender_profile_name: string | null
  /** IDs of the attached source contact lists (writable: sending the array replaces the set) */
  contact_lists: string[]
  /** IDs of the lists whose people are kept OUT of the campaign */
  excluded_lists: string[]
  contact_list_details: AttachedContactList[]
  runs: CampaignRun[]
  /** the stored status, or SCHEDULED while production published with its next send still ahead */
  display_status: string
  display_status_label: string
  /** what can be done now: edit, clone, test_publish, publish, pause, resume, cancel_schedule, archive, unarchive, results */
  actions: CampaignAction[]
  next_run_at: string | null
  list_count: number
  audience_size: number | null
  owner_name: string | null
  triggered_by: 'MANUAL' | 'JOURNEY'
  tags: string[]
  send_type: SendType
  send_timezone: string | null
  recurring_config: RecurringConfig | null
  drip_config: DripConfig | null
  respect_governance: boolean
  rate_limit_per_hour: number | null
  timezone_optimization: boolean
  targets: CampaignTargets | null
  published_at: string | null
  completed_at: string | null
  archived_at: string | null
  /** setup steps completed, 0 to 6 (the seventh step is the publish) */
  setup_step: number
  /** false: the campaign opens in the setup at step setup_step + 1, not on its page */
  setup_complete: boolean
  /** the workspace needs a second person to approve a production publish */
  approval_required: boolean
  /** the approval request on the campaign; null before any */
  approval: CampaignApproval | null
  /** the subject line test (email only); null or switched off = one subject */
  ab_config: AbConfig | null
  /** this campaign's own subject line and preheader (email only); null = the template's */
  subject_line: string | null
  preheader: string | null
  /** the preference-centre topic it is filed under; people who unticked it are left out */
  topic: string | null
  topic_name?: string | null
  /** drips only (null otherwise): the messages at a glance */
  drip_summary?: DripSummary | null
  /** drips only (null otherwise): each message by its latest production run */
  drip_progress?: DripProgress | null
  /** a drip whose remaining messages were stopped: it is COMPLETED, with this; null otherwise */
  stopped_early?: StoppedEarly | null
  /** while it is paused (any campaign type): when and by whom; null otherwise */
  paused?: CampaignPaused | null
}

export interface CampaignPaused {
  at: string
  by_name: string | null
}

export interface CampaignApproval {
  status: 'REQUESTED' | 'APPROVED' | 'RETURNED'
  requested_by: string | null
  requested_by_name: string | null
  requested_at: string | null
  note: string | null
  decided_by_name: string | null
  decided_at: string | null
  decision_note: string | null
}

export interface AbConfig {
  enabled: boolean
  subject_b?: string
  sample_pct?: number
  metric?: 'OPEN_RATE' | 'CLICK_RATE'
  decide_after_minutes?: number
}

export type CampaignAction = 'edit' | 'clone' | 'test_publish' | 'publish' | 'pause' | 'resume' | 'cancel_schedule' | 'archive' | 'unarchive' | 'results'
  | 'request_approval' | 'approve' | 'send_back' | 'stop'
export type SendType = 'IMMEDIATE' | 'SCHEDULED' | 'RECURRING' | 'DRIP'

export interface RecurringConfig {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  interval?: number
  /** MO TU WE TH FR SA SU, for a weekly recurrence */
  weekdays?: string[]
  day_of_month?: number
  /** HH:MM in the campaign's time zone */
  time: string
  end_date?: string | null
  max_runs?: number | null
}

export interface DripConfig {
  steps: { day: number; label?: string }[]
  time?: string
}

// ---------------------------------------------------------------- drips: a message per step (GET /campaigns/{id}/steps/, docs/CAMPAIGNS.md §10)
/** what a message still needs before it can be published */
export type DripStepProblem = 'NEEDS_TEMPLATE' | 'NEEDS_SUBJECT' | 'NEEDS_TEXT' | 'SAME_DAY'

export interface DripStep {
  id: string
  /** 1-based, in day order */
  position: number
  /** days after the start date (0-365) */
  day: number
  name: string
  /** HH:MM; null = the series time (drip_config.time) */
  send_time: string | null
  /** HH:MM the message goes at: its own, the series time, or the start's own time; null while that needs a start date */
  effective_send_time: string | null
  /** when it goes: the start date + day at effective_send_time, in the campaign's zone; null without a start date */
  scheduled_for: string | null
  /** this message's own template copy; null until chosen */
  template: { id: string; name: string; channel: Channel; status: string } | null
  /** null = the template's */
  subject_line: string | null
  preheader: string | null
  /** at most one message per drip, email only */
  ab_config: AbConfig | null
  problems: DripStepProblem[]
  /** SMS/MMS: the first 140 characters of the text, tags as written; null for email */
  text_excerpt?: string | null
  row_version: number
  /** GET /steps/ only: its latest production run and results; null until planned */
  run?: DripStepRun | null
  /** GET /steps/ (and a saved step) only: its test send */
  test?: DripStepTest
}

export interface DripStepRun {
  id: string
  status: string
  scheduled_at: string | null
  started_at: string | null
  completed_at: string | null
  sent: number
  delivered: number
  opened: number
  clicked: number
  unsubscribed: number
  /** percentages, one decimal */
  open_rate: number
  click_rate: number
  unsubscribe_rate: number
  /** queued but never sent: the drip was stopped early. Never counted in sent or failed */
  not_sent?: number
  /** texts only: answers, opt-outs included (as a text campaign's Replies) */
  replied?: number
  /** texts only */
  opted_out?: number
  /** the people left out of this message, by reason (FREQUENCY_CAP, UNSUBSCRIBED, NO_CONSENT ...) */
  skipped: { total: number; by_reason: { reason: string; count: number }[] }
  /** the subject line test's results, when this message was tested */
  ab: { variants: CampaignRunVariant[]; decide_at: string | null } | null
}

/** CHANGED: its content changed after the test, so it needs sending again */
export type DripTestStatus = 'NOT_SENT' | 'SENDING' | 'SENT' | 'CHANGED' | 'FAILED'

export interface DripStepTest {
  status: DripTestStatus
  sent_at: string | null
  /** FAILED: the provider's answer */
  error: string | null
  run_id: string | null
}

/** POST /steps/ */
export interface DripStepCreate {
  start_from: 'copy' | 'template' | 'blank'
  /** copy: the message to copy; default the last */
  source_step?: string
  /** template: copied for this message */
  template?: string
  /** template: a key from /template-starters/ instead */
  starter?: string
  /** default: the last message's day + 3 */
  day?: number
  name?: string
  /** template: remove the source after copying when it is your own unused Draft (a preset's throwaway copy) */
  consume_source?: boolean
}

/** PATCH /steps/{step}/: `template` copies that template in for the message */
export interface DripStepUpdate {
  name?: string
  day?: number
  send_time?: string | null
  subject_line?: string | null
  preheader?: string | null
  ab_config?: AbConfig | null
  template?: string
  consume_source?: boolean
  row_version?: number
}

export interface DripSummary {
  count: number
  last_day: number | null
  first_send_at: string | null
  last_send_at: string | null
  /** every message has what it needs */
  ready: boolean
}

export interface DripProgress {
  total: number
  /** messages whose latest production run completed or is sending */
  sent: number
  failed: number
  cancelled: number
  next: { position: number; name: string; scheduled_at: string | null } | null
}

export interface StoppedEarly {
  at: string
  by_name: string | null
  /** messages cancelled by the stop */
  cancelled: number
}

/** GET /campaign-runs/{id}/skipped/: the people one run left out */
export interface RunSkippedPerson {
  party_id: string
  first_name: string | null
  last_name: string | null
  address: string | null
  reason: string
}

export interface RunSkippedPage {
  run: { id: string; run_number: number; status: string; test_mode: boolean; family: string }
  count: number
  page: number
  page_size: number
  results: RunSkippedPerson[]
  by_reason: Record<string, number>
}

export type DripWarningCode = 'TOO_CLOSE' | 'FREQUENCY' | 'QUIET_HOURS'

/** GET /steps/review/: the Test & Publish timeline */
export interface DripReview {
  messages: {
    id: string
    position: number
    name: string
    day: number
    scheduled_for: string | null
    /** email: the subject as it will be sent; texts: the start of the text */
    subject: string | null
    /** the audience estimate: the same people for every message (fixed from Day 0) */
    estimated_recipients: number
    warnings: { code: DripWarningCode; message: string }[]
  }[]
  summary: { count: number; first_send_at: string | null; last_send_at: string | null; estimated_recipients: number }
}

/** GET /resume-plan/: what Resume does to a paused drip, without doing it (times in the campaign's zone) */
export interface ResumePlan {
  /** waiting messages whose time passed: they go at the next send time, one per day */
  missed: { position: number; name: string; was_due: string; will_send: string }[]
  /** later messages moved just enough to stay a day after a missed one */
  moved: { position: number; name: string; was_due: string; will_send: string }[]
  unchanged: { position: number; name: string; sends: string | null }[]
}

/** Money comes back as a string ("25000.00"): it is never rounded through a float. */
export interface CampaignTargets {
  target_revenue: string | null
  target_opens: number | null
  target_clicks: number | null
  target_conversions: number | null
  target_redemptions: number | null
  planned_cost: string | null
  planned_offer_cost: string | null
  notes: string | null
}

export type AttachedContactList = Pick<ContactList, 'id' | 'name' | 'list_kind' | 'is_master' | 'list_environment' | 'status' | 'member_count'> & {
  role?: 'INCLUDE' | 'EXCLUDE'
  attached_at?: string
}

/** Page-numbered list (campaigns): the total is known, so the table can say "51 to 100 of 214". */
export interface CountedPage<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface CampaignFormOptions {
  owners: { id: string; name: string; email: string }[]
  tags: string[]
  timezones: string[]
  workspace_timezone: string
}

export interface AudienceStatusLine {
  code: string
  label: string
  sendable: boolean
  count: number
}

export type ListChannel = 'EMAIL' | 'SMS' | 'BOTH'

export interface CampaignAudience {
  /** with ?local_time=1, or once the campaign sends at each recipient's local time: how many have a time zone CEP can work out */
  local_time?: { people: number; local_time_known: number }
  lists: { id: string; name: string; member_count: number; updated_at: string; list_environment: string; source_type: string; channel?: string; approval_status?: string; role: 'INCLUDE' | 'EXCLUDE' }[]
  gross: number
  unique: number
  duplicates_removed: number
  excluded_by_list: number
  after_exclusions: number
  estimated_recipients: number
  excluded_by_governance: number
  marketing: boolean
  channel: string
  statuses: AudienceStatusLine[]
  sample: { party_id: string; address: string | null; first_name: string | null; last_name: string | null; status: string; status_label: string }[]
  note: string
  /** the Campaign List of the last production send, once there is one */
  frozen?: { members: number; generated_at: string; eligible: number; suppressed: Record<string, number> }
}

export interface CampaignChecklist {
  ready: boolean
  problems: Record<string, string>
  test_sent: boolean
  items: { key: string; label: string; ok: boolean; problem: string | null; advisory?: boolean }[]
}

export interface CampaignPreview {
  subject: string | null
  /** the campaign's own preheader, else the template's, with sample values; '' when neither has one */
  preheader?: string
  html: string | null
  text: string | null
  version: number
  template: string
  tags_used: string[]
  customer: string | null
}

export interface CampaignMetrics {
  /** not_sent: queued but never sent (a drip stopped early), never in sent or failed */
  counts: Record<'queued' | 'sent' | 'failed' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'unsubscribed' | 'replied', number> & { not_sent?: number }
  conversions: number
  revenue: string | number | null
  rates: Record<'delivery' | 'open' | 'click' | 'bounce' | 'unsubscribe' | 'conversion', number>
  targets: { measure: string; target: number; actual: number; percent: number }[]
  breakdown: { by: 'domain' | 'carrier'; rows: { key: string; sent: number; delivered: number; opened: number; bounced: number }[]; note: string | null }
  runs: number
  test_runs: number
}

export interface CampaignTimeseries {
  bucket: 'hour' | 'day'
  points: { at: string; sent: number; delivered: number; opened: number; clicked: number }[]
}

export interface CampaignActivity {
  id: string
  event_type: string
  severity: 'INFO' | 'WARNING' | 'ERROR'
  message: string
  detail: Record<string, unknown> | null
  actor_name: string | null
  campaign_run_id: string | null
  occurred_at: string
}

/** GET /campaigns/calendar/ : one span per campaign that touches the window */
export interface CalendarSpan {
  campaign: string
  name: string
  code: string | null
  channel: string
  campaign_type: string
  display_status: string
  is_journey_generated: boolean
  setup_step: number
  setup_complete: boolean
  actions: CampaignAction[]
  timezone: string
  start: string
  /** null while the campaign goes on (an e-receipt campaign, a recurrence without an end) */
  end: string | null
  ongoing: boolean
  /** every production send of it failed */
  failed: boolean
  sends: CalendarSend[]
  /** a paused drip: its waiting messages, on no day until it resumes */
  on_hold?: { position: number; name: string; state?: 'ON_HOLD'; step_id: string }[]
}

export interface CalendarSend {
  at: string
  state: 'SENT' | 'SENDING' | 'WAITING' | 'PLANNED' | 'PROJECTED'
  label: string | null
  /** a drip's send: which message, of how many in the whole drip */
  position?: number
  count?: number
  name?: string
  step_id?: string
}

export interface CampaignCalendarData {
  date_from: string
  date_to: string
  timezone: string
  spans: CalendarSpan[]
}

export interface BulkResult {
  action: 'archive' | 'clone'
  done: { id: string; name: string }[]
  skipped: { id: string; name: string; reason: string }[]
}

/** Body of POST /campaigns/ and PATCH /campaigns/{id}/ */
export interface CampaignInput {
  name: string
  code?: string
  description: string | null
  campaign_type: string
  channel: Channel
  solicitation_type: string
  /** left out for a drip: each message has its own (PATCH /campaigns/{id}/steps/{step}/) */
  template?: string | null
  sender_profile: string | null
  contact_lists: string[]
  /** left out for a drip: its start date is set on the Sequence step */
  scheduled_at?: string | null
  excluded_lists?: string[]
  owner_user?: string | null
  tags?: string[]
  send_type?: SendType
  send_timezone?: string | null
  recurring_config?: RecurringConfig | null
  drip_config?: DripConfig | null
  respect_governance?: boolean
  rate_limit_per_hour?: number | null
  timezone_optimization?: boolean
  targets?: Partial<CampaignTargets> | null
  subject_line?: string | null
  preheader?: string | null
  topic?: string | null
  setup_step?: number
  /** optimistic lock on edit: the API answers 409 when the stored version is newer */
  row_version?: number
}

export interface SenderProfile {
  id: string
  display_name: string
  channel: 'EMAIL' | 'SMS' | 'MMS'
  from_address: string | null
  reply_to_address: string | null
  sender_id: string | null
  verification_status: 'PENDING' | 'VERIFIED' | 'FAILED'
  is_default: boolean
  /** POSTAL, DIGIVIZE, OTHER_ESP, OTHER_SMS or SMTP (the workspace's own mail server) */
  provider_type?: string
  provider_name?: string
}

export type ListSource = 'UPLOAD' | 'BI' | 'CLONE'

export interface ContactList extends Audited {
  name: string
  description: string | null
  source_type: 'UPLOAD' | 'BI' | 'EXTRACTION' | 'SEGMENT' | 'CLONE' | string
  /** "Upload", "BI / Extraction" or "Cloned" */
  source_label?: string
  /** where it came from in words: the file, the audience, the list it was copied from */
  source_reference?: string | null
  /** from an audience or a clone: a campaign being built attaches it without asking; an upload is only ever attached by hand */
  vetted?: boolean
  list_kind: 'STATIC' | 'DYNAMIC' | 'DERIVED' | 'SEGMENT' | string
  is_master: boolean
  refresh_mode: string
  last_refreshed_at: string | null
  list_environment: 'TEST' | 'PRODUCTION' | string
  /** what the list is for: the required upload column and how a new person is recognised */
  channel: ListChannel | string
  /** NOT_REQUIRED, or AWAITING / APPROVED / REFUSED under the workspace's consent policy; AWAITING and REFUSED hold the list out of every send */
  approval_status?: ListApprovalStatus
  approved_by_name?: string | null
  approved_at?: string | null
  approval_note?: string | null
  /** DRAFT = made by the upload wizard, waiting for its first import */
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | string
  member_count: number
  parent_contact_list: string | null
  parent_name?: string | null
  attached_campaigns?: number
  live_campaigns?: number
}

export interface ListStats {
  total_lists: number
  total_contacts: number
  attached_to_live_campaigns: number
}

/** an audience the data team defined (a C360 segment) */
export interface Audience {
  id: string
  code: string
  name: string
  description: string | null
  source_system: string
  synced_at: string
  member_count: number
  list_count: number
}

export interface ImportColumn {
  name: string
  samples: string[]
  guess: string | null
}

export interface ImportProperty {
  key: string
  label: string
  required: boolean
  help: string
}

export interface ImportReview {
  ready: number
  held_back: number
  new: number
  existing: number
  warnings: number
  errors: number
  duplicates: number
  rejected: number
}

export interface ImportIssue {
  line: number
  kind: 'error' | 'warning'
  message: string
  value: string
}

/** how a marketing email send would judge a contact today (same rules and order as the send engine) */
export interface GovernanceLine {
  code: 'MARKETABLE' | 'UNSUBSCRIBED' | 'HARD_BOUNCE' | 'SOFT_BOUNCE' | 'COMPLAINT' | 'BLOCKED' | 'INVALID_ADDRESS' | 'SUPPRESSED' | 'NO_CONSENT'
  label: string
  sendable: boolean
  count: number
}

/** An upload in numbers that add up: rows = held back + ready; ready = the governance lines; ready = added + already in the list. */
export interface UploadSummary {
  rows: number
  held_back: { total: number; reasons: { code: string; label: string; count: number }[] }
  ready: { total: number; new: number; existing: number }
  governance: { sendable: number; not_sendable: number; statuses: GovernanceLine[] }
  mobile: { with_number: number; blocked: number } | null
  /** after the import */
  result: { added: number; already_in_list: number; list_members_now: number; new_people: number; consents_recorded: number } | null
  balanced: boolean
}

export interface ListGovernance {
  total: number
  sendable: number
  not_sendable: number
  statuses: GovernanceLine[]
  checked_at: string
}

/** An upload is a background job: the API answers at once and the file is read, checked and imported by a worker. */
export type ListApprovalStatus = 'NOT_REQUIRED' | 'AWAITING' | 'APPROVED' | 'REFUSED'
export type ConsentBasis = 'WEB_FORM' | 'IN_STORE' | 'CUSTOMER_REQUEST' | 'IMPLIED'

/** the upload's declaration: where its people agreed, and the uploader's word that they did */
export interface ListConsentDeclaration {
  required: boolean
  basis: ConsentBasis | null
  basis_label: string | null
  collected_at: string | null
  attested_by_name: string | null
  attested_at: string | null
  /** the sentence the uploader confirms, with the workspace's name in it */
  attestation: string
  bases: { key: ConsentBasis; label: string; allowed: boolean }[]
  policy: { without_consent: 'HOLD_BACK' | 'REFUSE'; texts_need_date: boolean; approval_before_send: boolean }
}

/** Settings → Set-Up, and the Home card: the seven steps of a new workspace, read from the workspace, never ticked by hand */
export type SetupState = 'done' | 'todo' | 'warn'
export interface SetupStep {
  key: string
  label: string
  state: SetupState
  /** the status tag beside the links: Done, Not verified, Not checked */
  tag: string | null
  text: string
  /** the hint shown while this is the next step */
  why: string | null
  links: { label: string; to: string; primary: boolean }[]
  optional: boolean
}
export interface WorkspaceSetup {
  workspace: { name: string; code: string; plan: string | null; timezone: string }
  viewer: { first_name: string }
  steps: SetupStep[]
  done: number
  total: number
  /** every required step done: the first sign-in lands on Home and the card goes */
  ready: boolean
  /** the first required step left, or null when ready */
  next: string | null
  /** the Home card hidden with Hide Until Later (tenant.settings.setup.dismissed_at) */
  dismissed: boolean
}

/** Settings → Consent Policy */
export interface ConsentPolicy {
  without_consent: 'HOLD_BACK' | 'REFUSE'
  texts_need_date: boolean
  approval_before_send: boolean
  lifetime_months: number
  attestation: string
  attestation_preview: string
  workspace_name: string
  lifetimes: number[]
  bases: { key: ConsentBasis; label: string }[]
}

export interface ComplianceRecord {
  list: { id: string; name: string; channel: string; member_count: number; source_type: string; source_reference: string | null; created_at: string }
  /** a segment or a clone: its people carry the consent records of where they came from */
  inherited: boolean
  uploads: {
    id: string; file_name: string; completed_at: string | null; rows: number; applied: number; consents_recorded: number
    basis: ConsentBasis | null; basis_label: string | null; collected_at: string | null; attested_by_name: string | null; attested_at: string | null
    held_back: Record<string, number>
  }[]
  approval: { status: ListApprovalStatus; by_name: string | null; at: string | null; note: string | null }
  policy: { without_consent: 'HOLD_BACK' | 'REFUSE'; texts_need_date: boolean; approval_before_send: boolean; lifetime_months: number; attestation: string }
  consent: { channel: 'EMAIL' | 'SMS'; opted_in_from_file: number; confirmed_since: number; no_consent: number; unsubscribed: number }[]
  generated_at: string
}

export interface ListImport {
  id: string
  contact_list: string
  list_name: string
  list_status: string
  file_name: string
  file_size: number | null
  /** UPLOADED waiting to be read · STAGING being read · STAGED waiting for the mapping · MATCHING being checked ·
   *  REVIEW waiting for the operator · APPLYING being added · APPLIED / FAILED / CANCELLED */
  status: 'UPLOADED' | 'STAGING' | 'STAGED' | 'MATCHING' | 'REVIEW' | 'APPLYING' | 'APPLIED' | 'FAILED' | 'CANCELLED'
  /** the status in words, e.g. "Reading the file" */
  phase: string
  /** a worker is on it, or it is queued for one */
  working: boolean
  progress: { done: number; total: number; percent: number; unit: 'bytes' | 'rows' }
  mapping_confirmed: boolean
  error: string | null
  created_at: string
  completed_at: string | null
  created_by_name: string | null
  row_count: number
  columns: ImportColumn[]
  /** property -> column name */
  mapping: Record<string, string>
  properties: ImportProperty[]
  /** the list's channel: which properties are required */
  list_channel?: string
  review: ImportReview | null
  /** there once the file has been checked */
  summary?: UploadSummary | null
  issues?: ImportIssue[]
  applied_count: number
  new_people?: number
  consents_recorded?: number
  consent?: ListConsentDeclaration
  list?: ContactList
}

export interface ListMember {
  id: number
  party_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  mobile: string | null
  added_at: string
  source: 'UPLOAD' | 'RULE' | 'SEGMENT' | 'MANUAL' | 'CLONE' | string
  known: boolean
  email_status?: GovernanceLine['code']
  email_status_label?: string | null
  sendable?: boolean
}

export interface ListMembersPage {
  count: number
  page: number
  page_size: number
  results: ListMember[]
}

export interface ListUsage {
  campaigns: { id: string; name: string; code: string; status: string; channel: string; scheduled_at: string | null; attached_at: string; live: boolean; frozen_lists: number }[]
  attached_campaigns: number
  live_campaigns: number
  added_this_week: number
}

export interface ManualAddResult {
  added: number
  already_in_list: number
  new_people: number
  invalid: string[]
  member_count: number
}

export interface Template extends Audited {
  name: string
  description: string | null
  channel: Channel
  status: string
  cloned_from: string | null
  /** 0 / null until a design has been saved */
  latest_version?: number | null
  /** the newest campaign that uses it, or null: what is safe to change */
  last_used_in?: { id: string; name: string; status: string; at: string } | null
  campaign_count?: number
  /** the drip message using it, or null; locked: the drip is live, so the template can't be changed */
  used_in_drip?: { campaign_id: string; campaign_name: string; position: number; count: number; locked: boolean } | null
}

/** GET /template-starters/ : the gallery offered when creating a template */
export interface TemplateStarter {
  key: string
  name: string
  channel: Channel
  category: string
  description: string
  subject_line: string
  preheader: string
  /** server-rendered preview (EMAIL / E_RECEIPT) */
  html_content: string | null
  /** message text (SMS / MMS) */
  sms_body: string | null
}

/** A CEP-supplied template the landing page offers next to the workspace's own. Built by features/templates/presetSource. */
export interface Preset {
  key: string
  name: string
  channel: Channel
  category: string
  description: string
  purposeKey?: string
  triggerFamily?: string
  governanceClass?: 'MARKETING' | 'TRANSACTIONAL'
  receiptLayout?: ReceiptLayout['layout_preset']
  /** personalization tag keys the content uses; the preset is offered only when the workspace has all of them */
  requiredTags: string[]
  isSystem: true
  /** set when the frontend owns the content: the copy is filled from this instead of the server's starter */
  content?: PresetContent
}

/** What a frontend-owned preset puts into version 1 of its copy. */
export type PresetContent =
  | { kind: 'design'; mjml: string; subject_line: string; preheader: string }
  | { kind: 'message'; sms_body: string; subject_line: string }
  /** an e-receipt: the outer design, then the receipt layout that fills its slot */
  | { kind: 'receipt'; subject_line: string; preheader: string; mjml: string; layout_preset: ReceiptLayoutPreset; sections: ReceiptSection[] }

export interface PersonalizationTag {
  id: string
  tag_key: string
  label: string
  tag_kind: 'STANDARD' | 'CUSTOM' | 'INNER_TEMPLATE' | 'SEGMENT' | 'SYSTEM' | string
  data_type: string
  applies_to_channels: string[]
  description: string | null
  sample_value: string | null
  default_value: string | null
  static_value: string | null
  is_active: boolean
  /** inherited from the platform catalogue: the back-office changes it, the workspace cannot */
  platform_tag_id?: string | null
  /** where the value is read from at send time (Settings -> Tags) */
  resolution_source?: string
  source_path?: string | null
  format_spec?: string | null
  row_version?: number
}

/** GET /personalization-tags/data-points/: what a tag can read */
export interface TagDataPoints {
  sources: { key: string; label: string; points: { path: string; label: string; data_type: string; prefix: boolean }[] }[]
  static: { key: string; label: string }
}

export interface DesignFindings {
  tags_used: string[]
  unknown_tags: string[]
  missing_unsubscribe: boolean
  missing_subject: boolean
  html_bytes: number
  may_be_clipped: boolean
}

/** GET / POST /templates/{id}/design/ */
export interface Design {
  template: string
  /** 0 = nothing saved yet */
  version_number: number
  latest_version: number
  editor_state: Record<string, unknown> | null
  mjml_source: string | null
  html_content: string | null
  text_content: string | null
  subject_line: string
  preheader: string
  saved_at: string | null
  saved_by: string | null
  findings?: DesignFindings
}

export interface DesignSaveInput {
  editor_state: Record<string, unknown>
  mjml_source: string
  subject_line: string
  preheader: string
  /** the version the editor loaded: the API answers 409 when a newer one exists */
  base_version: number
}

export interface MessageFindings {
  encoding: 'GSM-7' | 'UCS-2'
  /** billable characters of the text with sample values filled in */
  units: number
  segments: number
  per_segment: number
  non_gsm_characters: string[]
  /** true when tags make the real length vary per recipient */
  estimated: boolean
  tags_used: string[]
  unknown_tags: string[]
  wrong_channel_tags: string[]
  missing_opt_out: boolean
  long_message: boolean
  has_link: boolean
  missing_media: boolean
  media_bytes: number | null
  media_heavy: boolean
}

/** GET / POST /templates/{id}/message/ (SMS and MMS templates) */
export interface Message {
  template: string
  channel: string
  /** 0 = nothing saved yet */
  version_number: number
  latest_version: number
  sms_body: string
  subject_line: string
  media_asset: Pick<MediaAsset, 'id' | 'url' | 'file_name' | 'mime_type' | 'byte_size' | 'width_px' | 'height_px'> | null
  saved_at: string | null
  saved_by: string | null
  findings: MessageFindings
}

export interface MessageSaveInput {
  sms_body: string
  /** MMS only */
  subject_line: string
  /** MMS only: id of an uploaded image */
  media_asset: string | null
  base_version: number
}

export interface DesignVersion {
  version_number: number
  saved_at: string
  saved_by: string | null
}

/** REGISTER: the paper receipt as the register prints it, a fixed layout with nothing to configure */
export type ReceiptLayoutPreset = 'COMPACT' | 'STANDARD' | 'ITEMIZED' | 'REGISTER' | 'CUSTOM_HTML'
interface ReceiptSectionBase {
  label: string
  /** required sections: always visible, can't be hidden or removed */
  locked: boolean
  visible: boolean
  order: number
  /** informational only, e.g. "Order.lineItems[]" */
  data_binding: string | null
}

export interface ReceiptHeaderSection extends ReceiptSectionBase {
  key: 'header'
  fields: { order_number: boolean; order_date: boolean; store: boolean; receipt_id: boolean }
}

export interface ReceiptCustomerFulfillmentSection extends ReceiptSectionBase {
  key: 'customer_fulfillment'
  address_mode: 'AUTO' | 'SHIP_TO' | 'PICKUP'
  delivery_estimate: boolean
}

export interface ReceiptItemsSection extends ReceiptSectionBase {
  key: 'items'
  columns: { product_image: boolean; sku: boolean; quantity: boolean; unit_price: boolean; amount: boolean }
  row_height: 'COMPACT' | 'DEFAULT'
}

/** the Total row always renders, so it isn't a toggle */
export interface ReceiptTotalsSection extends ReceiptSectionBase {
  key: 'totals'
  rows: { subtotal: boolean; discount: boolean; tax: boolean; shipping: boolean; tip: boolean }
  savings_callout: boolean
}

export interface ReceiptPaymentSection extends ReceiptSectionBase {
  key: 'payment'
  fields: { method: boolean; authorization_time: boolean; billing_address: boolean }
}

export interface ReceiptLoyaltySection extends ReceiptSectionBase {
  key: 'loyalty'
  fields: { points_earned: boolean; points_balance: boolean; tier_progress: boolean }
}

export interface ReceiptSupportSection extends ReceiptSectionBase {
  key: 'support'
  policy_text: string
  barcode: boolean
}

export type ReceiptSection =
  | ReceiptHeaderSection
  | ReceiptCustomerFulfillmentSection
  | ReceiptItemsSection
  | ReceiptTotalsSection
  | ReceiptPaymentSection
  | ReceiptLoyaltySection
  | ReceiptSupportSection

export type ReceiptSectionKey = ReceiptSection['key']

/** GET / POST /templates/{id}/receipt/ : the receipt layout half of an E-Receipt template (the outer design is a Design, elsewhere in this file) */
export interface ReceiptLayout {
  template: string
  /** 0 = nothing saved yet */
  version_number: number
  latest_version: number
  layout_preset: ReceiptLayoutPreset
  sections: ReceiptSection[]
  /** only used when layout_preset is CUSTOM_HTML */
  custom_html: string | null
  custom_css: string | null
  saved_at: string | null
  saved_by: string | null
}

export interface ReceiptLayoutSaveInput {
  layout_preset: ReceiptLayoutPreset
  sections: ReceiptSection[]
  custom_html: string | null
  custom_css: string | null
  /** the version the editor loaded: the API answers 409 when a newer one exists */
  base_version: number
}

export interface MediaAsset {
  id: string
  file_name: string
  mime_type: string
  byte_size: number
  width_px: number | null
  height_px: number | null
  url: string
  created_at: string
}

/** apps/journeys/listing.py's 4 trigger groups: which family a journey's entry rule falls under (the List page's
 * "Triggered by" filter and column — the Setup modal, 6e, isn't built yet, so there's no stored family). */
export type JourneyTriggerFamily = 'CUSTOMER_LIFECYCLE' | 'SEGMENT_LOYALTY' | 'COMMERCE_OFFER' | 'ENGAGEMENT'

export interface Journey extends Audited {
  code: string | null
  name: string
  description: string | null
  status: string
  population_mode: 'FIXED' | 'CONTINUOUSLY_QUALIFYING' | 'EVENT_TRIGGERED' | string
  reentry_policy: 'NEVER' | 'AFTER_X_DAYS' | 'EVERY_QUALIFYING_EVENT' | string
  reentry_after_days: number | null
  current_version: string | null
  /** set with status 'APPROVED': when the Approve · Schedule for later action goes live (apps/journeys/publish.py) */
  scheduled_activate_at: string | null
  /** free text, e.g. "First purchase in 30 days"; not modeled logic (apps/journeys/models.py's Journey docstring) */
  goal_description: string | null
  /** free text, e.g. "Goal met · unsubscribe · 45 days" */
  exit_criteria_description: string | null
  /** annotated on GET /journeys/{id}/ : the newest version number */
  latest_version: number | null
  owner_user: string | null
  /** owner_user's display name, falling back to email; null when there's no owner */
  owner_user_name: string | null
  /** computed, apps/journeys/listing.py: EMAIL/SMS/MMS node types on the journey's newest version */
  channels: ('EMAIL' | 'SMS' | 'MMS' | string)[]
  trigger_family: JourneyTriggerFamily | null
  trigger_family_label: string | null
  /** computed: most recent generated campaign run FAILED in the last 7 days */
  needs_attention: boolean
  /** computed, apps/journeys/listing.py: every step after the entry trigger on the newest version */
  step_count: number
  /** computed: those steps' node types in canvas order (trunk, a Condition's YES branch, then its NO branch) */
  step_types: (JourneyNodeType | string)[]
  /** computed: the newest version's first entry rule, for the Your Journeys cards' trigger line; null when none */
  entry_rule: JourneyEntryRule | null
  /** the saved template this journey was made from (journey_template id), if any. Save as Template left the UI on
   * 2026-10-05; the API still returns it for journeys made from one before then */
  source_template?: string | null
  /** the CEP starter this journey was made from (apps/journeys/starters.py key), if any */
  source_starter_key?: string | null
  /** the template's or starter's name, for "From {name}" on the canvas */
  source_name?: string | null
}

export type JourneyTemplateCategory = 'LIFECYCLE' | 'COMMERCE' | 'LOYALTY' | 'ENGAGEMENT'

/** GET /journey-starters/ : one of CEP's ten ready-made journeys (apps/journeys/starters.py) */
export interface JourneyStarter {
  key: string
  name: string
  category: JourneyTemplateCategory
  description: string
  goal: string
  population_mode: Journey['population_mode']
  reentry_policy: Journey['reentry_policy']
  reentry_after_days: number | null
  graph: JourneyGraph
  /** every step after the entry trigger */
  step_count: number
  channels: string[]
}

/** GET /journeys/stats/ : the List page's former 4 stat cards (the page no longer calls it, 2026-10-05) */
export interface JourneyStats {
  active_journeys: number
  total_journeys: number
  currently_enrolled: number
  /** week-over-week change; null when nobody was enrolled a week ago */
  currently_enrolled_change_pct: number | null
  completed_30d: number
  campaign_runs_today: number
  campaign_runs_today_by_channel: Record<string, number>
}

/** journey_node.node_type (apps/journeys/engine/steps.py documents each config shape) */
export type JourneyNodeType =
  | 'START' | 'WAIT' | 'CONDITION' | 'SPLIT' | 'EMAIL' | 'SMS' | 'MMS'
  | 'COUPON_ISSUE' | 'LOYALTY_CHANGE' | 'SEGMENT_UPDATE' | 'EXIT'

/** GET /journeys/{id}/versions/ : one row, no graph */
export interface JourneyVersion {
  id: string
  journey: string
  version_number: number
  status: 'DRAFT' | 'TEST_PUBLISHED' | 'ACTIVE' | 'RETIRED' | string
  status_label: string
  published_at: string | null
  created_by: string | null
  created_at: string
  updated_by: string | null
  updated_at: string
  row_version: number
}

export interface JourneyGraphNode {
  /** stable within the version's graph; the canvas assigns one when a step is added */
  key: string
  type: JourneyNodeType
  config: Record<string, unknown>
  position: { x: number; y: number } | null
}

export interface JourneyGraphConnection {
  from: string
  to: string
  /** 'YES' | 'NO' out of a Condition; null otherwise */
  branch_key: string | null
  label: string | null
}

export interface JourneyEntryRule {
  id?: string
  entry_type: 'CUSTOMER_LIST' | 'EVENT' | 'DATE_TIME' | 'SEGMENT_CHANGE' | string
  rule_definition: Record<string, unknown>
  /** read-only (apps/journeys/graph.py name_references): present when the rule names a contact list or segment —
   * its current name, or null when that list or segment is deleted or unknown */
  reference_name?: string | null
}

/** the whole document PUT to /journeys/{id}/versions/{n}/graph/ and read back from GET .../{n}/ */
export interface JourneyGraph {
  entry_rules: JourneyEntryRule[]
  nodes: JourneyGraphNode[]
  connections: JourneyGraphConnection[]
}

/** GET /journeys/{id}/versions/{n}/ : a version with its graph */
export interface JourneyVersionDetail extends JourneyVersion {
  graph: JourneyGraph
}

/** GET /journeys/{id}/versions/{n}/readiness/ : the Test Publish page's 4 checks */
export interface JourneyReadinessItem {
  key: 'entry_rules' | 'steps_configured' | 'templates_ready' | 'governance' | string
  label: string
  description: string
  ok: boolean
}

export interface JourneyReadiness {
  ready: boolean
  items: JourneyReadinessItem[]
}

/** the test population POST /journeys/{id}/versions/{n}/test-publish/ sends */
export interface JourneyTestPopulation {
  mode: 'RANDOM' | 'LIST'
  sample_size?: number
  contact_list_ids?: string[]
}

/** POST /journeys/{id}/versions/{n}/test-publish/ response: real counts from the test send */
export interface JourneyTestResult {
  population_size: number
  sent_to: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  governance_flags: string[]
  /** only the channels the version's message steps use; MMS counts as SMS */
  by_channel: Partial<Record<'EMAIL' | 'SMS', { sent: number; delivered: number }>>
}

/** GET /journeys/{id}/performance/ 's "metrics" key : Journey Details' 4 metric cards (apps/journeys/details.py); null for a Draft journey */
export interface JourneyMetrics {
  enrolled: number | null
  in_journey: number | null
  goal_converted: number | null
  goal_converted_pct: number | null
  exited_early: number | null
  exited_early_pct: number | null
}

/** GET /journeys/{id}/audience/ : Journey Details' Setup card, Audience & enrollment */
export interface JourneyAudience {
  source_lists: { id: string; name: string }[]
  eligible_pool: number | null
  enrollment_rate_per_day: number | null
}

/** GET /journeys/{id}/enrollment-trend/ : one bucket of the 6-week chart */
export interface JourneyTrendWeek {
  week_start: string
  enrolled: number
  goal_converted: number
  exited_early: number
}

/** GET /journeys/{id}/campaigns/ : one row of the Generated Campaigns table */
export interface JourneyGeneratedCampaignRow {
  id: string
  campaign_id: string
  campaign_name: string
  node_key: string
  node_type: JourneyNodeType | string
  generation_date: string
  last_run_at: string | null
  recipients: number
  status: string | null
}

/** GET /journeys/{id}/activity/ : one entry of the derived Activity log, newest first */
export interface JourneyActivityEntry {
  event_type: 'CREATED' | 'PUBLISHED' | 'PAUSED' | string
  message: string
  actor_name: string | null
  occurred_at: string
  version_number: number | null
}

/** Cached C360 reference, same shape as Segment (customers.Coupon) — see GET /coupons/ note in JourneyBuildPage */
export interface Coupon {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
}

/** Cached C360 reference, same shape as Segment (customers.LoyaltyTier) — see GET /loyalty-tiers/ note in JourneyBuildPage */
export interface LoyaltyTier {
  id: string
  code: string
  name: string
  rank: number
  description: string | null
}

/** GET /users/ (tenant settings; requires user.admin) */
export interface SettingsUser {
  id: string
  email: string
  display_name: string
  is_active: boolean
  auth_provider: 'LOCAL' | 'SAML' | 'OIDC' | string
  mfa_enabled: boolean
  last_login: string | null
  created_at: string
  /** role ids (writable: sending the array replaces the set) */
  roles: string[]
  role_names: string[]
  has_password: boolean
  is_self: boolean
}

export interface Role {
  id: string
  name: string
  description: string | null
  /** permission codes (writable: replaces the set) */
  permissions: string[]
  user_count: number
  row_version: number
}

export interface PermissionDef {
  code: string
  description: string | null
}

export interface PasswordLink {
  /** path of the one-time page; the client prefixes its own origin */
  path: string
  expires_in_hours: number
  /** true when the platform emailed the link itself */
  emailed?: boolean
  /** false when no mail server is configured: the link can only be copied */
  email_configured?: boolean
  email?: string
}

export interface ApiKey {
  id: string
  name: string
  client_type: string
  key_prefix: string
  scopes: string[]
  allowed_ip_cidrs: string[] | null
  rate_limit_per_minute: number | null
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  created_at: string
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED'
}

/** POST /api-clients/ : the only response that ever carries the full key */
export interface ApiKeyCreated extends ApiKey {
  key: string
}

export interface Workspace {
  name: string
  code: string
  timezone: string
  status: string
  subdomain: string | null
  region: string | null
  plan: string | null
  max_users: number | null
  active_users: number
  roles: number
  active_api_keys: number
}

/** Permission codes issued by the API (identity.permission.code). */
export type PermissionCode =
  | 'campaign.edit'
  | 'campaign.publish'
  | 'campaign.approve'
  | 'list.edit'
  | 'template.edit'
  | 'journey.edit'
  | 'journey.activate'
  | 'user.admin'
  | (string & {})

// ---------------------------------------------------------------------------------------------------- integrations
export type IntegrationHealth = 'healthy' | 'degraded' | 'circuit_open' | 'paused' | 'idle'
export type IntegrationOutcome = 'OK' | 'REJECTED' | 'RETRY' | 'ERROR' | 'THROTTLED' | 'BREAKER' | 'PAUSED'

/** GET /integrations/: one line per integration with the last day's figures */
export interface Integration {
  id: string
  kind: 'POS_RECEIPTS' | 'PROVIDER' | 'ORDERS' | 'EVENTS' | 'COUPONS'
  name: string
  direction: 'IN' | 'OUT'
  system: string
  status: 'ACTIVE' | 'PAUSED'
  environment: string | null
  delivery_provider_id: string | null
  throttle_per_minute: number | null
  throttle_burst: number | null
  /** inbound only: the workspace's own limit, else the plan's default */
  effective_limit_per_minute?: number | null
  log_level: 'FULL' | 'ERRORS' | 'NONE'
  log_retention_days: number
  last_call_at: string | null
  last_outcome: IntegrationOutcome | null
  last_error: string | null
  breaker_failures: number
  breaker_cooldown_seconds: number
  breaker_open_seconds: number
  calls_24h: number
  ok_24h: number
  rejected_24h: number
  retried_24h: number
  errors_24h: number
  throttled_24h: number
  error_rate_24h: number
  p95_ms: number | null
  max_ms: number | null
  bytes_in_24h: number
  bytes_out_24h: number
  health: IntegrationHealth
  /** the Email Alerts switch on the card: a circuit opening on this integration notifies the workspace */
  alerts_enabled?: boolean
}

/** GET /contact-lists/{id}/reach/: how many of the list a marketing send could reach today, by channel */
export interface ListReach {
  email: { total: number; sendable: number }
  sms: { total: number; sendable: number; no_phone: number }
  checked_at: string
}

/** GET /search/?q= : a few campaigns, lists and templates by name */
export interface SearchResults {
  q: string
  campaigns: { id: string; name: string; code: string | null; channel: string; status: string; status_label: string; setup_complete: boolean }[]
  lists: { id: string; name: string; member_count: number; list_environment: string; status: string }[]
  templates: { id: string; name: string; channel: string; status: string }[]
}

export interface IntegrationLogRow {
  id: number
  integration_id: string | null
  direction: 'IN' | 'OUT'
  kind: string
  system: string
  correlation_id: string | null
  related_ref: string | null
  method: string
  url: string
  response_status: number | null
  outcome: IntegrationOutcome
  error_class: string | null
  error_message: string | null
  attempt: number
  duration_ms: number | null
  request_bytes: number | null
  response_bytes: number | null
  api_client_id: string | null
  started_at: string
}

export interface IntegrationLogDetail extends IntegrationLogRow {
  request_headers: Record<string, string> | null
  request_body: string | null
  response_headers: Record<string, string> | null
  response_body: string | null
  worker: string | null
}

/** GET /integrations/{id}/metrics/: one bucket per step where there were calls */
export interface IntegrationMetricBucket {
  bucket: string
  calls: number
  ok: number
  rejected: number
  failed: number
  throttled: number
  p95_ms: number | null
}

export interface IntegrationMetrics {
  hours: number
  step_minutes: number
  buckets: IntegrationMetricBucket[]
}

export interface IntegrationLogPage {
  results: IntegrationLogRow[]
  count: number
  page: number
  page_size: number
}

/** POST /codes/sample/ : a barcode or QR code block's sample, drawn by the same code that draws the sent email's */
export interface CodeSampleRequest {
  kind: 'barcode' | 'qr'
  format?: string
  width?: number
  height?: number
  ecc?: string
  size?: number
  value: string
}

export interface CodeSample {
  valid: boolean
  /** a signed image address, when valid */
  url?: string
  /** why the value cannot be drawn, when not */
  message?: string
}

// ---------------------------------------------------------------- Reports (GET /reports/summary/, /reports/compare/, /reports/schedule/)
export type ReportRates = Record<'delivery' | 'open' | 'click' | 'bounce' | 'unsubscribe', number>
export type ReportCounts = Record<'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'failed', number>

export interface ReportCampaignRow extends ReportCounts {
  id: string
  name: string
  channel: Channel
  campaign_type: string
  first_sent_at: string | null
  unsubscribed: number
  revenue: number | null
  conversions: number
  rates: ReportRates
}

export interface ReportHighlight {
  id: string
  name: string
  rates: ReportRates
}

export interface ReportSummary {
  period: { from: string; to: string; timezone: string; days: number }
  channel: Channel | null
  totals: ReportCounts & { unsubscribed: number; replied: number; campaigns: number; revenue: number | null; conversions: number }
  rates: ReportRates
  by_channel: Record<string, ReportCounts>
  days: { day: string; sent: number; delivered: number; opened: number; clicked: number }[]
  campaigns: ReportCampaignRow[]
  /** a highlight is null when no campaign sent enough (50) for its rate to mean anything */
  highlights: {
    highest_open_rate: ReportHighlight | null
    highest_click_rate: ReportHighlight | null
    most_unsubscribes: ReportHighlight | null
    best_send_hour: { hour: number; open_rate: number } | null
  }
}

export interface ReportCompareCampaign {
  id: string
  name: string
  channel: Channel
  campaign_type: string
  status: string
  published_at: string | null
  metrics: CampaignMetrics
  days: CampaignTimeseries['points']
}

/** the weekly report email; weekday 0 = Monday, hour in the workspace's zone */
export interface ReportSchedule {
  enabled: boolean
  weekday: number
  hour: number
  recipients: string[]
  last_sent_on: string | null
}

// ---------------------------------------------------------------- Suppressions (GET /suppressions/, /suppressions/summary/)
export type SuppressionGroup = 'UNSUBSCRIBED' | 'BOUNCED' | 'COMPLAINED' | 'BLOCKED'

export interface SuppressionRow {
  /** CONTACT_POINT: a bounce, a complaint or a block; CONSENT: what the person decided */
  kind: 'CONTACT_POINT' | 'CONSENT'
  id: string
  channel: 'EMAIL' | 'PHONE'
  contact: string
  party_id: string | null
  name: string | null
  reason: string
  reason_label: string
  group: SuppressionGroup
  source: string | null
  source_label: string | null
  detail: string | null
  since: string | null
  /** a bounce or a block by a person can be undone; an opt-out or a complaint cannot */
  can_unblock: boolean
}

export interface SuppressionPage {
  count: number
  page: number
  page_size: number
  results: SuppressionRow[]
}

/** one recipient of a run: CEP's record of the message (GET /campaign-runs/{id}/recipients/) */
export interface RunRecipient {
  id: number
  party_id: string
  address: string
  status: string
  status_reason: string | null
  /** STOPPED_EARLY: queued but never sent (status reads NOT_SENT); null otherwise */
  not_sent_reason?: string | null
  provider_message_id: string | null
  attempts: number
  variant_key: string | null
  bounce_type: string | null
  created_at: string
  submitted_at: string | null
  delivered_at: string | null
  opened_at: string | null
  clicked_at: string | null
  bounced_at: string | null
  complained_at: string | null
  failed_at: string | null
  send_after: string | null
  first_name: string | null
  last_name: string | null
}

export interface RunRecipientPage {
  run: { id: string; run_number: number; status: string; test_mode: boolean; family: 'EMAIL' | 'SMS' }
  count: number
  page: number
  page_size: number
  results: RunRecipient[]
  by_status: Record<string, number>
  statuses: string[]
}

export interface RunRecipientEvent {
  at: string
  /** cep: a timestamp on the message; tracking: an open or click; callback: what the engine sent back */
  kind: 'cep' | 'tracking' | 'callback'
  what: string
  detail: string | null
  id?: number
}

export interface RunRecipientDetail {
  recipient: RunRecipient
  events: RunRecipientEvent[]
  callbacks: number
  /** the engine calls for this message in the integration log */
  log: { id: number; at: string; direction: 'IN' | 'OUT'; outcome: string; response_status: number | null; error: string | null }[]
  standing: { blocked: boolean; block_reason: string | null; hard_bounces: number; soft_bounces: number; complaints: number; consent: string; opt_out_method: string | null } | null
}

/** the engine's own record of a message (POST .../check/), Postal today */
export interface ProviderMessageStatus {
  provider: string
  provider_type: string
  id: number | null
  message_id: string | null
  status: string | null
  held: boolean
  hold_expiry: string | null
  last_delivery_attempt: string | null
  to: string | null
  from: string | null
  subject: string | null
  sent_at: string | null
  deliveries: { at: string | null; status: string | null; details: string | null; output: string | null; sent_with_ssl: boolean | null; time: number | null }[]
}

/** a store of the workspace, by the number the point of sale sends (GET /stores/) */
export interface Store {
  id: string
  store_number: string
  name: string
  brand: string | null
  address1: string | null
  address2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string | null
  district: string | null
  phone: string | null
  email: string | null
  manager: string | null
  return_policy: string | null
  url1: string | null
  url2: string | null
  url3: string | null
  url4: string | null
  image_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type StoreInput = Omit<Store, 'id' | 'created_at' | 'updated_at'>

/** Settings → POS Receipts (GET/PUT /workspace/pos/) */
export interface PosSettings {
  campaign: string | null
  return_campaign: string | null
  /** the e-receipt campaign on the SMS channel used when the transaction's EntryType asks for a text */
  text_campaign: string | null
  /** two-letter country for reading a ten-digit phone number (US / CA add +1) */
  default_country: string
  endpoint: string
  tenant_key: string
  headers: string[]
  scope: string
  campaigns: { id: string; name: string; code: string | null; status: string; channel: string; ready: boolean }[]
  stores: number
}

/** one transaction the point of sale posted, as the integration log kept it (GET /workspace/pos/received/) */
export interface PosReceived {
  id: number
  at: string
  transaction_id: string | null
  code: string | null
  code_label: string | null
  message: string | null
  http_status: number | null
  outcome: string
  execution_id: number | null
  message_id: string | null
  bytes: number
  duration_ms: number | null
}

export interface PosReceivedPage {
  results: PosReceived[]
  more: boolean
  next_before: string | null
  days: number
}

export interface CampaignSuppressions extends SuppressionPage {
  summary: SuppressionSummary
}

export interface SuppressionSummary {
  total: number
  this_week: number
  groups: { key: SuppressionGroup; label: string; count: number; email: number; phone: number; this_week: number }[]
}

export interface SuppressionBlockResult {
  blocked: number
  already_blocked: number
  /** the first 20 values that were not an address or a number */
  invalid: string[]
  invalid_count: number
}

// ---------------------------------------------------------------- Notifications (GET / PUT /workspace/notifications/)
export interface NotificationChannels {
  /** the campaign's owner, by email */
  owner: boolean
  /** the fixed addresses, by email */
  recipients: boolean
  webhook: boolean
}

export interface NotificationSettings {
  emails: string[]
  webhook_url: string
  webhook_tested_at: string | null
  events: Record<string, NotificationChannels>
  muted_integrations: string[]
  catalogue: { key: string; label: string; hint: string }[]
}

export interface NotificationTestResult {
  email: number
  webhook: boolean
  webhook_configured: boolean
  emails_configured: number
}

// ---------------------------------------------------------------- Approvals (GET / PUT /workspace/approvals/)
export interface SubscriptionTopic {
  id: string
  code: string
  name: string
  description: string | null
  channels: ('EMAIL' | 'SMS')[]
  is_shown: boolean
  sort_order: number
  /** people who unticked it on the preference page */
  opted_out: number
  /** campaigns filed under it */
  campaigns: number
  created_at: string
  updated_at: string
}

export interface SubscriptionTopicInput {
  name: string
  description?: string | null
  channels: ('EMAIL' | 'SMS')[]
  is_shown: boolean
}

/** GET /subscription-topics/: the switch state travels with the list, so the campaign setup knows whether to ask */
export interface SubscriptionTopicList {
  enabled: boolean
  results: SubscriptionTopic[]
}

export interface PreferenceCenterSettings {
  enabled: boolean
  brand_name: string
  heading: string
  email_description: string
  sms_description: string
  footer: string
  privacy_url: string
  allow_opt_in: boolean
  workspace_name: string
  tag: string
  preview_url: string
  stats: { days: number; opened: number; unsubscribed: number; opted_in: number; topics_unticked: number }
  topics: number
}

export interface ApprovalSettings {
  require_approval: boolean
  permission: string
  /** campaigns waiting for a decision now */
  awaiting: number
  approvers: { id: string; name: string; email: string }[]
}

// ---------------------------------------------------------------- A/B subject lines on a run (GET /campaigns/{id}/runs/{run}/)
export interface CampaignRunVariant {
  variant_key: 'A' | 'B'
  subject_line: string | null
  allocation_pct: number
  /** null until the winner is chosen */
  is_winner: boolean | null
  winner_metric: 'OPEN_RATE' | 'CLICK_RATE' | null
  metric_value: number | null
  sent?: number
  delivered?: number
  opened?: number
  clicked?: number
  open_rate?: number
  click_rate?: number
  /** the rest of the audience, held back until the winner is known */
  waiting_for_winner: number
  decide_at: string | null
}

export interface CampaignRunDetail extends CampaignRun {
  variants: CampaignRunVariant[]
}

/** POST /campaigns/{id}/test-publish/: one line per message; with a subject line test each address gets A and B */
export interface TestPublishResult {
  run: string
  status: string
  results: { to: string; ok: boolean; detail: string | null; variant?: 'A' | 'B'; subject?: string }[]
}

// ---------------------------------------------------------------- Home overview (GET /home/overview/)
export interface HomeOverviewAttention {
  /** campaigns whose production send failed in the last week (not paused, not waiting for approval) */
  failed_ids: string[]
  awaiting_publish: number
  awaiting_approval: number
  /** drips in trouble: a message nobody received, or paused 3+ days */
  drip_problems?: DripProblem[]
}

export type DripProblem =
  | { kind: 'MESSAGE_FAILED'; campaign_id: string; campaign_name: string; position: number; message_name: string; failed_at: string }
  | { kind: 'PAUSED_LONG'; campaign_id: string; campaign_name: string; paused_at: string; paused_by_name: string | null
      next: { position: number; name: string; was_due: string | null } | null }

export interface HomeRevenueCost {
  granularity: 'day' | 'week'
  /** one per day, or per week over a month; revenue null throughout when no campaign in scope has attributed revenue */
  points: { day: string; revenue: number | null; cost: number; target_pace: number | null }[]
  by_campaign: { top: { id: string; name: string; revenue: number }[]; others: { count: number; revenue: number } | null }
  summary: { revenue: number | null; cost: number; roi: number | null; revenue_per_1000_delivered: number | null }
}

export interface HomeGovernance {
  contacted: number
  held_back: number
  reasons: { frequency_cap: number; no_consent: number; suppression: number }
}

export interface HomeJourneyRow {
  id: string
  name: string
  /** FAILED: the journey's last run failed */
  status: 'ACTIVE' | 'PAUSED' | 'FAILED'
  channels: string[]
  paused_at: string | null
  paused_by: string | null
  failing_since: string | null
  /** the failed step's channel */
  failing_step: string | null
  in_flight: number
  entered: number
  completed: number
  conversion_rate: number
}

export interface HomeOverview {
  period: { from: string; to: string; timezone: string; days: number }
  attention: HomeOverviewAttention
  /** null: the viewer cannot read reports */
  revenue_cost: HomeRevenueCost | null
  governance: HomeGovernance | null
  /** null: the workspace has no journeys feature, or the viewer cannot read journeys */
  journeys: { rows: HomeJourneyRow[]; total: number } | null
}

/** GET /field-rules/: what each writable field accepts, read off the serializers and the tables behind them */
export interface FieldRule {
  type: 'string' | 'email' | 'url' | 'slug' | 'uuid' | 'boolean' | 'integer' | 'decimal' | 'datetime' | 'date' | 'time' | 'choice' | 'choices' | 'reference' | 'references' | 'list' | 'object' | 'json'
  required: boolean
  label?: string
  /** characters, from the table column when the serializer sets none; null when the column is unlimited text */
  max?: number | null
  min?: number | null
  blank?: boolean
  nullable?: boolean
  pattern?: string
  min_value?: number | string | null
  max_value?: number | string | null
  decimal_places?: number | null
  max_digits?: number | null
  choices?: { value: string; label: string }[]
  column?: { table: string; column: string; type: string; max: number | null }
  /** for object and list rules */
  fields?: Record<string, FieldRule>
}

export interface FieldRules {
  generated_at: string
  resources: Record<string, Record<string, FieldRule>>
}

/** Deliverability testing: the workspace's inbox-preview account (GET /deliverability/service/) */
export interface DeliverabilityService {
  configured: boolean
  provider: string
  region: 'US' | 'EU'
  username: string
  has_api_key: boolean
  default_clients: string[]
  image_blocking: boolean
  is_active: boolean
  last_checked_at: string | null
  last_check_ok: boolean | null
  last_check_error: string | null
  /** which account the workspace's tests run through: its own, the platform's (back-office), or none */
  uses?: 'OWN' | 'PLATFORM' | null
  /** the platform's account is set up and switched on */
  platform_available?: boolean
}

/** one inbox client the service can render in (GET /deliverability/clients/) */
export interface InspectClient {
  id: string
  client: string
  os: string
  category: string
  browser: string
  default: boolean
  image_blocking: boolean
}

/** GET /deliverability/allowance/: tests this month against the plan */
export interface DeliverabilityAllowance {
  enabled: boolean
  used: number
  /** null = unlimited */
  limit: number | null
  left: number | null
  month: string
  plan: string | null
  configured: boolean
  /** the plan's monthly number (null: unlimited) and the tests added for this month */
  plan_limit?: number | null
  added?: number
  account?: 'OWN' | 'PLATFORM' | null
  /** where the number comes from, in words */
  note?: string
}

export interface DeliverabilityPreview {
  id: string
  name: string
  client: string
  os: string
  category: string
  browser: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED'
  detail: string
  screenshot: string
  screenshot_no_images: string
  thumbnail: string
  full_thumbnail: string
}

export interface DeliverabilityTest {
  id: string
  template: string
  template_version: number
  kind: 'PREVIEW' | 'SPAM' | 'PLACEMENT'
  provider: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED'
  subject: string | null
  clients: string[]
  summary: { clients?: number | null; complete?: number; failed?: number; processing?: number | null }
  error: string | null
  requested_by: string | null
  requested_at: string
  completed_at: string | null
  /** empty in the history list; the detail carries them */
  previews: DeliverabilityPreview[]
  /** the slots the panel shows; filled when the spam check and inbox placement arrive */
  spam: null | { verdict: string; score: number | null; detail: string }
  placement: null | { inbox: number; spam: number; missing: number; providers: { name: string; folder: string }[] }
}

export interface DeliverabilityTestList {
  tests: DeliverabilityTest[]
  allowance: DeliverabilityAllowance
}

// ---- attribution (Settings → Attribution; GET /attribution/settings/, /attribution/orders/)
export type TouchType = 'CODE' | 'CLICK' | 'OPEN' | 'TEXT' | 'REFUND'

export interface AttributionSummary {
  days: number
  orders: number
  revenue: number
  attributed_revenue: number
  attributed_orders: number
  attributed_share: number | null
  pending: number
  unattributed: number
  last_received_at: string | null
  by_touch: Record<'CODE' | 'CLICK' | 'OPEN' | 'TEXT', { orders: number; revenue: number }>
  top_campaigns: { id: string; name: string; revenue: number; orders: number }[]
  store_orders: number
}

export interface AttributionSettings {
  enabled: boolean
  enabled_at: string | null
  click_days: number
  open_days: number
  text_days: number
  store_sales: boolean
  email_cost_per_1000: number | null
  text_cost_per_1000: number | null
  choices: { click_days: number[]; open_days: number[]; text_days: number[] }
  currency: string
  endpoint: string
  scope: string
  keys_with_scope: number
  store_sales_available: boolean
  summary: AttributionSummary
}

export type AttributionSettingsInput = Partial<Pick<AttributionSettings, 'enabled' | 'click_days' | 'open_days' | 'text_days' | 'store_sales'>> & {
  email_cost_per_1000?: number | string | null
  text_cost_per_1000?: number | string | null
}

export interface AttributedOrder {
  id: number
  source: 'API' | 'POS'
  order_id: string
  kind: 'ORDER' | 'REFUND'
  amount: number
  currency: string
  ordered_at: string
  channel: string
  store_number: string | null
  party_id: string | null
  email: string | null
  phone: string | null
  status: 'PENDING' | 'ATTRIBUTED' | 'UNATTRIBUTED'
  campaign_id: string | null
  campaign_name: string | null
  touch_type: TouchType | null
  touch_at: string | null
  note: string | null
  received_at: string
}

// ---- journey events (Settings → Events; GET /workspace/events/, /workspace/events/recent/)
/** GET /journeys/date-attributes/ : a date on customer records a Date / Time entry can follow */
export interface JourneyDateAttribute {
  key: string
  label: string
  customers: number
}

export interface JourneyEventType {
  event_type: string
  label: string
  from_tracking: boolean
}

export interface EventsSettings {
  endpoint: string
  scope: string
  keys_with_scope: number
  journeys_enabled: boolean
  types: JourneyEventType[]
  summary: {
    days: number
    total: number
    by_type: { event_type: string; label: string; count: number; last_received_at: string }[]
    last_received_at: string | null
    unknown_customers: number
  }
  coupons: { endpoint: string; scope: string; keys_with_scope: number; requested: number; issued: number; failed: number }
}

export interface JourneyEventRow {
  id: number
  event_type: string
  label: string
  source: string
  party_id: string
  event_id: string | null
  payload: Record<string, unknown>
  occurred_at: string
  received_at: string
  customer_name: string | null
}
