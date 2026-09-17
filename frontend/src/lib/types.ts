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
  contact_list_details: AttachedContactList[]
  runs: CampaignRun[]
}

export type AttachedContactList = Pick<ContactList, 'id' | 'name' | 'list_kind' | 'is_master' | 'list_environment' | 'status' | 'member_count'>

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
}

export interface ContactList extends Audited {
  name: string
  description: string | null
  source_type: string
  list_kind: 'STATIC' | 'DYNAMIC' | 'DERIVED' | string
  is_master: boolean
  refresh_mode: string
  last_refreshed_at: string | null
  list_environment: string
  status: string
  member_count: number
  parent_contact_list: string | null
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

/** Permission codes issued by the API (identity.permission.code). */
export type PermissionCode =
  | 'campaign.edit'
  | 'campaign.publish'
  | 'list.edit'
  | 'template.edit'
  | 'journey.edit'
  | (string & {})
