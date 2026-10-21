"""delivery — generated from the CEP DDL (do not hand-edit table definitions; change the DDL and regenerate).

Every model is managed = False: the four DDL files own the tables (partitions, RLS, triggers and CHECKs cannot
be expressed in Django). Composite primary keys use Django 5.2+ CompositePrimaryKey; partitioned high-volume
tables expose `id` as the pk for ORM convenience while the real key is (id, tenant_id, <partition key>).
"""
import json
import uuid

from django.db import models
from django.db.models.functions import Now


class DeliveryProvider(models.Model):
    """Postal / Digivize / future ESP configuration; secrets held by reference only"""
    class ProviderType(models.TextChoices):
        POSTAL = 'POSTAL', 'Postal'
        DIGIVIZE = 'DIGIVIZE', 'Digivize'
        OTHER_ESP = 'OTHER_ESP', 'Other ESP'
        OTHER_SMS = 'OTHER_SMS', 'Other SMS'
        SMTP = 'SMTP', 'SMTP (workspace mail server)'
        SENDGRID = 'SENDGRID', 'SendGrid'
        SANDBOX_SMS = 'SANDBOX_SMS', 'Sandbox texts (sends nothing)'

    class Channel(models.TextChoices):
        EMAIL = 'EMAIL', 'Email'
        SMS = 'SMS', 'SMS'
        MMS = 'MMS', 'MMS'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    provider_type = models.CharField(max_length=20, choices=ProviderType.choices)  # POSTAL, DIGIVIZE, OTHER_ESP, OTHER_SMS, SMTP
    channel = models.CharField(max_length=20, choices=Channel.choices)  # EMAIL, SMS, MMS
    name = models.CharField(max_length=150)
    config = models.JSONField(default=dict)  # non-secret settings: endpoint, webhook path, sending domain
    secret_ref = models.CharField(max_length=200, null=True, blank=True)  # env:NAME / vault key for credentials kept outside the database
    secret_enc = models.TextField(null=True, blank=True)  # credential entered in the product, encrypted with FIELD_ENCRYPTION_KEY; wins over secret_ref
    transactional_secret_enc = models.TextField(null=True, blank=True)  # second credential for transactional traffic (receipts); NULL = secret_enc carries everything
    last_checked_at = models.DateTimeField(null=True, blank=True)
    last_check_ok = models.BooleanField(null=True, blank=True)
    last_check_error = models.TextField(null=True, blank=True)
    rate_limit_per_minute = models.IntegerField(null=True, blank=True)  # provider throughput cap honoured by workers
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'delivery_provider'
        constraints = [
            models.UniqueConstraint(fields=['tenant_id', 'name'], name='ux_delivery_provider_tenant_id_name'),
        ]

    def __str__(self):
        return str(self.name)


class DeliveryProviderHealth(models.Model):
    """The latest Engine Health result per sending engine (apps/delivery/health.py; patch 0068)"""
    delivery_provider = models.OneToOneField(DeliveryProvider, on_delete=models.DO_NOTHING, primary_key=True, db_column='delivery_provider_id', related_name='health')
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    status = models.CharField(max_length=10)  # HEALTHY, ATTENTION, FAILING, QUIET
    summary = models.CharField(max_length=300, null=True, blank=True)
    checks = models.JSONField(default=list)
    figures = models.JSONField(default=dict)
    checked_at = models.DateTimeField()
    status_since = models.DateTimeField()

    class Meta:
        managed = False
        db_table = 'delivery_provider_health'
        verbose_name = 'engine health'
        verbose_name_plural = 'Engine Health'

    def __str__(self):
        return f"{self.delivery_provider_id}: {self.status}"


class SenderProfile(models.Model):
    """Verified from-name / from-address / SMS sender id per channel and provider"""
    class Channel(models.TextChoices):
        EMAIL = 'EMAIL', 'Email'
        SMS = 'SMS', 'SMS'
        MMS = 'MMS', 'MMS'

    class VerificationStatus(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        VERIFIED = 'VERIFIED', 'Verified'
        FAILED = 'FAILED', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    delivery_provider = models.ForeignKey('delivery.DeliveryProvider', on_delete=models.PROTECT, db_column='delivery_provider_id', related_name='sender_profiles')
    channel = models.CharField(max_length=20, choices=Channel.choices)  # EMAIL, SMS, MMS
    display_name = models.CharField(max_length=150)  # "Citi Trends Rewards"
    from_address = models.TextField(null=True, blank=True)  # email channel
    reply_to_address = models.TextField(null=True, blank=True)  # case-insensitive (CITEXT) in the database
    sender_id = models.CharField(max_length=30, null=True, blank=True)  # SMS/MMS short code or long number
    verification_status = models.CharField(max_length=20, default='PENDING', choices=VerificationStatus.choices)  # PENDING, VERIFIED, FAILED (SPF/DKIM/10DLC)
    is_default = models.BooleanField(default=False)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    deleted_at = models.DateTimeField(null=True, blank=True)
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'sender_profile'

    def __str__(self):
        return str(self.display_name)


class MailerExecution(models.Model):
    """Email send/outcome record per recipient per run, idempotency-keyed (range-partitioned)"""
    class Status(models.TextChoices):
        QUEUED = 'QUEUED', 'Queued'
        SUBMITTED = 'SUBMITTED', 'Submitted'
        DELIVERED = 'DELIVERED', 'Delivered'
        OPENED = 'OPENED', 'Opened'
        CLICKED = 'CLICKED', 'Clicked'
        BOUNCED = 'BOUNCED', 'Bounced'
        COMPLAINED = 'COMPLAINED', 'Complained'
        FAILED = 'FAILED', 'Failed'

    class BounceType(models.TextChoices):
        HARD = 'HARD', 'Hard'
        SOFT = 'SOFT', 'Soft'

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.DO_NOTHING, db_column='campaign_id', related_name='mailer_executions', db_constraint=False)
    campaign_run = models.ForeignKey('campaigns.CampaignRun', on_delete=models.DO_NOTHING, db_column='campaign_run_id', related_name='mailer_executions', db_constraint=False)
    campaign_list_member_id = models.BigIntegerField(null=True, blank=True)
    party_id = models.CharField(max_length=60)
    email_address = models.TextField()  # case-insensitive (CITEXT) in the database
    template_version_id = models.UUIDField(null=True, blank=True)
    subject_line = models.CharField(max_length=300, null=True, blank=True)
    idempotency_key = models.CharField(max_length=200)  # tenant_id+campaign_run_id+party_id+channel+communication_version
    status = models.CharField(max_length=20, default='QUEUED', choices=Status.choices)  # QUEUED, SUBMITTED, DELIVERED, OPENED, CLICKED, BOUNCED, COMPLAINED, FAILED
    status_reason = models.CharField(max_length=200, null=True, blank=True)
    not_sent_reason = models.CharField(max_length=30, null=True, blank=True)  # STOPPED_EARLY: queued, then never sent (patch 0044); status stays FAILED
    provider_message_id = models.CharField(max_length=200, null=True, blank=True)  # Postal message id
    bounce_domain = models.CharField(max_length=200, null=True, blank=True)
    bounce_type = models.CharField(max_length=10, null=True, blank=True, choices=BounceType.choices)  # HARD, SOFT — drives contact_point_status blocking
    user_agent = models.TextField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    opened_at = models.DateTimeField(null=True, blank=True)
    clicked_at = models.DateTimeField(null=True, blank=True)
    bounced_at = models.DateTimeField(null=True, blank=True)
    complained_at = models.DateTimeField(null=True, blank=True)
    delivery_provider_id = models.UUIDField(null=True, blank=True)  # which provider carried the message
    attempts = models.IntegerField(default=0)
    variant_key = models.CharField(max_length=20, null=True, blank=True)  # A | B | HOLD while a subject test runs (patch 0023)
    send_after = models.DateTimeField(null=True, blank=True)  # the recipient's local send time (patch 0023)
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'mailer_execution'
        # real primary key is (id, tenant_id, created_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.party_id)


class SmsExecution(models.Model):
    """SMS/MMS send/outcome record per recipient per run, idempotency-keyed (range-partitioned)"""
    class MessageType(models.TextChoices):
        SMS = 'SMS', 'SMS'
        MMS = 'MMS', 'MMS'

    class Status(models.TextChoices):
        QUEUED = 'QUEUED', 'Queued'
        SUBMITTED = 'SUBMITTED', 'Submitted'
        DELIVERED = 'DELIVERED', 'Delivered'
        RESPONDED = 'RESPONDED', 'Responded'
        FAILED = 'FAILED', 'Failed'
        OPTED_OUT = 'OPTED_OUT', 'Opted Out'

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.DO_NOTHING, db_column='campaign_id', related_name='sms_executions', db_constraint=False)
    campaign_run = models.ForeignKey('campaigns.CampaignRun', on_delete=models.DO_NOTHING, db_column='campaign_run_id', related_name='sms_executions', db_constraint=False)
    campaign_list_member_id = models.BigIntegerField(null=True, blank=True)
    party_id = models.CharField(max_length=60)
    phone_number = models.CharField(max_length=30)
    message_type = models.CharField(max_length=10, default='SMS', choices=MessageType.choices)  # SMS, MMS
    template_version_id = models.UUIDField(null=True, blank=True)
    segment_count = models.SmallIntegerField(null=True, blank=True)
    media_url = models.TextField(null=True, blank=True)  # MMS only
    from_sender_id = models.CharField(max_length=30, null=True, blank=True)  # iCRM FROM_PHONE: short code / long number the message was sent from
    provider_code = models.CharField(max_length=40, null=True, blank=True)  # iCRM SMS_ENGINE (DIGIVIZE, TWILIO ...) — the hardening layer links this to delivery_provider
    internal_batch_id = models.CharField(max_length=250, null=True, blank=True)  # iCRM INT_BATCH_ID: the worker batch this row was submitted in
    provider_batch_id = models.CharField(max_length=250, null=True, blank=True)  # iCRM EXT_BATCH_ID: provider-side batch / campaign id
    rendered_text = models.TextField(null=True, blank=True)  # iCRM TEXT_CONTENT: exact message body sent (compliance / replay)
    personalization_payload = models.JSONField(null=True, blank=True)  # iCRM PERSONALIZATION_TAGS: merge values used for this recipient
    provider_acked_at = models.DateTimeField(null=True, blank=True)  # iCRM RESPONSED_TIME: provider HTTP acknowledgement of the submission
    response_code = models.CharField(max_length=60, null=True, blank=True)  # iCRM RESPONSE_CODE
    provider_response = models.JSONField(null=True, blank=True)  # iCRM RESPONSED_DATA + RESPONSED_HEADERS
    idempotency_key = models.CharField(max_length=200)
    status = models.CharField(max_length=20, default='QUEUED', choices=Status.choices)  # QUEUED, SUBMITTED, DELIVERED, RESPONDED, FAILED, OPTED_OUT
    status_reason = models.CharField(max_length=200, null=True, blank=True)
    not_sent_reason = models.CharField(max_length=30, null=True, blank=True)  # STOPPED_EARLY: queued, then never sent (patch 0044); status stays FAILED
    provider_message_id = models.CharField(max_length=200, null=True, blank=True)  # Digivize message id
    submitted_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    failed_at = models.DateTimeField(null=True, blank=True)
    send_after = models.DateTimeField(null=True, blank=True)  # the recipient's local send time (patch 0023)
    created_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'sms_execution'
        # real primary key is (id, tenant_id, created_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.party_id)


class DeliveryWebhookEvent(models.Model):
    """Raw inbound Postal/Digivize webhook log ahead of processing (range-partitioned)"""
    class Provider(models.TextChoices):
        POSTAL = 'POSTAL', 'Postal'
        DIGIVIZE = 'DIGIVIZE', 'Digivize'

    class ExecutionType(models.TextChoices):
        MAILER = 'MAILER', 'Mailer'
        SMS = 'SMS', 'SMS'

    class ProcessingStatus(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        PROCESSED = 'PROCESSED', 'Processed'
        FAILED = 'FAILED', 'Failed'
        DUPLICATE = 'DUPLICATE', 'Duplicate'      # the provider delivered this event before: kept, not applied

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    provider = models.CharField(max_length=20, choices=Provider.choices)  # POSTAL, DIGIVIZE
    execution_type = models.CharField(max_length=10, choices=ExecutionType.choices)  # MAILER, SMS
    execution_ref = models.CharField(max_length=200)  # provider_message_id / idempotency_key
    event_type = models.CharField(max_length=30)
    raw_payload = models.JSONField()
    received_at = models.DateTimeField(db_default=Now())
    processed_at = models.DateTimeField(null=True, blank=True)
    processing_status = models.CharField(max_length=20, default='PENDING', choices=ProcessingStatus.choices)  # PENDING, PROCESSED, FAILED, DUPLICATE
    provider_event_id = models.CharField(max_length=100, null=True, blank=True)  # the provider's own id of the event (Postal: the webhook uuid)

    class Meta:
        managed = False
        db_table = 'delivery_webhook_event'
        # real primary key is (id, tenant_id, received_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.event_type)


class DeadLetterMessage(models.Model):
    """Permanently failed sends persisted for operator review and replay (range-partitioned)"""
    class Channel(models.TextChoices):
        EMAIL = 'EMAIL', 'Email'
        SMS = 'SMS', 'SMS'
        MMS = 'MMS', 'MMS'

    class Status(models.TextChoices):
        OPEN = 'OPEN', 'Open'
        RETRIED = 'RETRIED', 'Retried'
        DISCARDED = 'DISCARDED', 'Discarded'

    id = models.BigAutoField(primary_key=True)  # partitioned: real PK is (id, tenant_id, <partition key>)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.DO_NOTHING, db_column='tenant_id', related_name='+', db_constraint=False)
    queue_name = models.CharField(max_length=80)  # marketing_email, sms, transactional, journey, webhook...
    task_name = models.CharField(max_length=200)
    campaign_run = models.ForeignKey('campaigns.CampaignRun', on_delete=models.DO_NOTHING, db_column='campaign_run_id', related_name='dead_letter_messages', db_constraint=False, null=True, blank=True)
    party_id = models.CharField(max_length=60, null=True, blank=True)
    channel = models.CharField(max_length=20, null=True, blank=True, choices=Channel.choices)  # EMAIL, SMS, MMS
    idempotency_key = models.CharField(max_length=200, null=True, blank=True)
    payload = models.JSONField()
    error_class = models.CharField(max_length=200)
    error_message = models.TextField(null=True, blank=True)
    attempts = models.IntegerField(default=1)
    status = models.CharField(max_length=20, default='OPEN', choices=Status.choices)  # OPEN, RETRIED, DISCARDED
    resolved_by = models.UUIDField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    first_failed_at = models.DateTimeField(db_default=Now())
    last_failed_at = models.DateTimeField(db_default=Now())

    class Meta:
        managed = False
        db_table = 'dead_letter_message'
        # real primary key is (id, tenant_id, first_failed_at); Django uses id — always filter by tenant_id so PostgreSQL prunes partitions

    def __str__(self):
        return str(self.party_id)


class DeliverabilityService(models.Model):
    """An account with an inbox-preview service (Mailgun Inspect), the key encrypted: a workspace's own (one per tenant), or the
    platform's (tenant NULL, back-office -> Configuration -> Mailgun Inspect) that every workspace without its own uses (patch 0039).
    A workspace's row may hold only its choice of clients, without credentials, while it uses the platform's account."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.OneToOneField('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+', null=True, blank=True)
    provider = models.CharField(max_length=30, default='MAILGUN_INSPECT')
    region = models.CharField(max_length=10, default='US')  # US, EU
    username = models.CharField(max_length=200, null=True, blank=True)
    api_key_enc = models.TextField(null=True, blank=True)
    default_clients = models.JSONField(default=list)  # Inspect client ids a test renders in; empty = the service's defaults
    image_blocking = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)
    last_check_ok = models.BooleanField(null=True, blank=True)
    last_check_error = models.TextField(null=True, blank=True)
    created_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='created_by', related_name='+', null=True, blank=True)
    updated_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='updated_by', related_name='+', null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'deliverability_service'


class DeliverabilityTest(models.Model):
    """One test of a template's content: inbox previews today; spam verdict and inbox placement have their slots."""
    class Kind(models.TextChoices):
        PREVIEW = 'PREVIEW', 'Inbox previews'
        SPAM = 'SPAM', 'Spam check'
        PLACEMENT = 'PLACEMENT', 'Inbox placement'

    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        PROCESSING = 'PROCESSING', 'Processing'
        COMPLETE = 'COMPLETE', 'Complete'
        FAILED = 'FAILED', 'Failed'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    tenant = models.ForeignKey('tenants.Tenant', on_delete=models.PROTECT, db_column='tenant_id', related_name='+')
    template = models.ForeignKey('templates.TemplateMaster', on_delete=models.CASCADE, db_column='template_id', related_name='deliverability_tests')
    template_version = models.IntegerField()
    campaign = models.ForeignKey('campaigns.Campaign', on_delete=models.SET_NULL, db_column='campaign_id', related_name='+', null=True, blank=True)
    kind = models.CharField(max_length=20, default='PREVIEW', choices=Kind.choices)
    provider = models.CharField(max_length=30)
    account = models.CharField(max_length=10, default='OWN')  # OWN (the workspace's account) | PLATFORM (counted against the plan); patch 0039
    provider_test_id = models.CharField(max_length=100, null=True, blank=True)
    status = models.CharField(max_length=20, default='PENDING', choices=Status.choices)
    subject = models.CharField(max_length=300, null=True, blank=True)
    clients = models.JSONField(default=list)
    summary = models.JSONField(default=dict)  # {"clients": n, "complete": n, "failed": n, "processing": n}
    results = models.JSONField(default=dict)  # per client id: name, client, os, category, browser, status, screenshot, thumbnail
    error = models.TextField(null=True, blank=True)
    requested_by = models.ForeignKey('identity.AppUser', on_delete=models.PROTECT, db_column='requested_by', related_name='+', null=True, blank=True)
    requested_at = models.DateTimeField(db_default=Now())
    checked_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(db_default=Now())
    updated_at = models.DateTimeField(db_default=Now())
    row_version = models.IntegerField(default=1)

    class Meta:
        managed = False
        db_table = 'deliverability_test'
