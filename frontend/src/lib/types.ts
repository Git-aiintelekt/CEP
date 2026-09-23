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
}

export interface TokenPair {
  access: string
  refresh: string
}

export interface Page<T> {
  next: string | null
  previous: string | null
  results: T[]
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
}

export type Feature = 'email' | 'sms' | 'mms' | 'ereceipt' | 'journeys' | 'ab_testing' | 'loyalty' | 'api_access' | 'webhooks' | 'sso' | 'custom_domain' | 'scoring'

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
  fields: { key: string; label: string; required: boolean; secret: boolean; help: string; placeholder: string; kind: 'text' | 'url' | 'textarea' }[]
}

export interface DeliveryProvider {
  id: string
  provider_type: string
  channel: string
  name: string
  config: Record<string, string>
  /** the credential itself is write-only */
  has_secret: boolean
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
  /** send through the platform's shared server with this workspace's From address */
  use_platform_server: boolean
  /** also offered as a campaign delivery provider + sender profile */
  campaign_sender: boolean
  is_active: boolean
  last_tested_at: string | null
  last_test_ok: boolean | null
  last_test_error: string | null
}

export interface MailServerSettings {
  server: MailServer | null
  /** the platform team shares its server with this workspace */
  platform_shared: boolean
  platform_host: string | null
  /** what messages for this workspace currently go through */
  in_use: 'tenant' | 'platform-shared' | 'platform' | 'environment' | 'console' | string
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
}

export type CampaignAction = 'edit' | 'clone' | 'test_publish' | 'publish' | 'pause' | 'resume' | 'cancel_schedule' | 'archive' | 'unarchive' | 'results'
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

export interface CampaignAudience {
  lists: { id: string; name: string; member_count: number; updated_at: string; list_environment: string; source_type: string; role: 'INCLUDE' | 'EXCLUDE' }[]
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
  html: string | null
  text: string | null
  version: number
  template: string
  tags_used: string[]
  customer: string | null
}

export interface CampaignMetrics {
  counts: Record<'queued' | 'sent' | 'failed' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained' | 'unsubscribed' | 'replied', number>
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
  template: string | null
  sender_profile: string | null
  contact_lists: string[]
  scheduled_at: string | null
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
  review: ImportReview | null
  /** there once the file has been checked */
  summary?: UploadSummary | null
  issues?: ImportIssue[]
  applied_count: number
  new_people?: number
  consents_recorded?: number
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

export type ReceiptLayoutPreset = 'COMPACT' | 'STANDARD' | 'ITEMIZED' | 'CUSTOM_HTML'
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

export interface Journey extends Audited {
  code: string | null
  name: string
  description: string | null
  status: string
  population_mode: string
  reentry_policy: string
  current_version: string | null
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
  | 'list.edit'
  | 'template.edit'
  | 'journey.edit'
  | 'user.admin'
  | (string & {})
