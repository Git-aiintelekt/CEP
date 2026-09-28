"""Starter templates: the gallery offered when someone creates a template, and the samples loaded into a tenant.

One source for every tenant. A starter is only a beginning: choosing one creates an ordinary template whose version 1 is
this content (rendered through the same save path as the editors), which the tenant then edits freely.

The MJML sticks to components both renderers know (mrml on the server, grapesjs-mjml in the designer): sections,
columns, groups, text, buttons, dividers, spacers. No images: a text wordmark and coloured bands stay intact in
every preview, and people add their own pictures from the asset library.
"""
from functools import lru_cache

from rest_framework.exceptions import ValidationError

from . import design
from .models import PersonalizationTag

BRAND, INK, MUTED, CANVAS = "#2753e4", "#0f172a", "#64748b", "#f6f7fb"

HEAD = f"""  <mj-head>
    <mj-attributes>
      <mj-all font-family="Helvetica, Arial, sans-serif" />
      <mj-text font-size="15px" line-height="24px" color="#334155" padding="6px 0" />
      <mj-button background-color="{BRAND}" color="#ffffff" border-radius="8px" font-weight="700" font-size="15px" inner-padding="12px 28px" />
      <mj-section padding="0 24px" />
    </mj-attributes>
  </mj-head>"""

WORDMARK = f"""    <mj-section background-color="#ffffff" padding="24px 24px 8px">
      <mj-column>
        <mj-text font-size="20px" font-weight="700" color="{INK}" letter-spacing="0.5px">YOUR BRAND</mj-text>
      </mj-column>
    </mj-section>"""

MARKETING_FOOTER = f"""    <mj-section padding="20px 24px 28px">
      <mj-column>
        <mj-text font-size="12px" line-height="18px" color="{MUTED}" align="center">
          You are receiving this email because you subscribed to updates from Your Brand.<br />
          Your Brand &#183; 123 Market Street &#183; Your City<br />
          <a href="{{{{unsubscribe_url}}}}" style="color:{MUTED}">Unsubscribe</a>
        </mj-text>
      </mj-column>
    </mj-section>"""

RECEIPT_FOOTER = f"""    <mj-section padding="20px 24px 28px">
      <mj-column>
        <mj-text font-size="12px" line-height="18px" color="{MUTED}" align="center">
          This receipt was sent because you asked for an email copy of your purchase.<br />
          Questions about this purchase? Reply to this email or visit any of our stores.
        </mj-text>
      </mj-column>
    </mj-section>"""


def _email(body: str, footer: str = MARKETING_FOOTER, wordmark: bool = True) -> str:
    return f"""<mjml>
{HEAD}
  <mj-body background-color="{CANVAS}">
{WORDMARK if wordmark else ""}
{body}
{footer}
  </mj-body>
</mjml>"""


def _band(title: str, subtitle: str, color: str = BRAND) -> str:
    return f"""    <mj-section background-color="{color}" padding="40px 32px">
      <mj-column>
        <mj-text font-size="30px" line-height="38px" font-weight="700" color="#ffffff" align="center">{title}</mj-text>
        <mj-text font-size="16px" line-height="24px" color="#e0e7ff" align="center">{subtitle}</mj-text>
      </mj-column>
    </mj-section>"""


def _row(label: str, value: str, bold: bool = False) -> str:
    weight = ' font-weight="700" color="#0f172a"' if bold else ""
    return f"""    <mj-section background-color="#ffffff" padding="0 24px">
      <mj-group>
        <mj-column width="60%"><mj-text{weight}>{label}</mj-text></mj-column>
        <mj-column width="40%"><mj-text align="right"{weight}>{value}</mj-text></mj-column>
      </mj-group>
    </mj-section>"""


WELCOME = _email(_band("Welcome, {{first_name}}!", "We are glad you are here.") + f"""
    <mj-section background-color="#ffffff" padding="28px 24px 8px">
      <mj-column>
        <mj-text>Thanks for joining. Here is what you can look forward to:</mj-text>
        <mj-text><strong>Member pricing</strong> on new arrivals every season.</mj-text>
        <mj-text><strong>Points on every purchase</strong>, in store and online.</mj-text>
        <mj-text><strong>Early access</strong> to sales before anyone else.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="8px 24px 32px">
      <mj-column>
        <mj-button href="{{{{shop_url}}}}" align="left">Start shopping</mj-button>
      </mj-column>
    </mj-section>""")

PROMOTION = _email(_band("{{discount_pct}}% off this weekend", "Our biggest offer of the season, for members only.", "#be123c") + f"""
    <mj-section background-color="#ffffff" padding="28px 24px 8px">
      <mj-column>
        <mj-text>Hi {{{{first_name}}}},</mj-text>
        <mj-text>Take {{{{discount_pct}}}}% off everything, in store and online, through Sunday night. Use your personal code at checkout:</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="8px 24px">
      <mj-column border="2px dashed #be123c" border-radius="10px" padding="6px">
        <mj-text font-size="26px" line-height="34px" font-weight="700" color="#be123c" align="center" letter-spacing="3px">{{{{offer_code}}}}</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="16px 24px 32px">
      <mj-column>
        <mj-button href="{{{{shop_url}}}}" background-color="#be123c">Shop the sale</mj-button>
        <mj-text font-size="12px" line-height="18px" color="{MUTED}" align="center">One use per member. Cannot be combined with other offers.</mj-text>
      </mj-column>
    </mj-section>""")

NEWSLETTER = _email(f"""    <mj-section background-color="#ffffff" padding="8px 24px 0">
      <mj-column>
        <mj-text font-size="13px" color="{MUTED}" text-transform="uppercase" letter-spacing="1px">The monthly edit</mj-text>
        <mj-text font-size="26px" line-height="34px" font-weight="700" color="{INK}">What is new this month</mj-text>
        <mj-text>Hi {{{{first_name}}}}, here are three things worth your time.</mj-text>
        <mj-divider border-width="1px" border-color="#e5e8f0" padding="12px 0" />
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="0 24px">
      <mj-column>
        <mj-text font-size="18px" font-weight="700" color="{INK}">1. The headline story</mj-text>
        <mj-text>Two or three sentences that say why this matters to the reader, not to you. <a href="{{{{shop_url}}}}" style="color:{BRAND}">Read more</a></mj-text>
        <mj-divider border-width="1px" border-color="#e5e8f0" padding="12px 0" />
        <mj-text font-size="18px" font-weight="700" color="{INK}">2. A second story</mj-text>
        <mj-text>Keep each item short. One idea, one link. <a href="{{{{shop_url}}}}" style="color:{BRAND}">Read more</a></mj-text>
        <mj-divider border-width="1px" border-color="#e5e8f0" padding="12px 0" />
        <mj-text font-size="18px" font-weight="700" color="{INK}">3. Something useful</mj-text>
        <mj-text>A tip, a guide or an event. <a href="{{{{shop_url}}}}" style="color:{BRAND}">Read more</a></mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="16px 24px 32px">
      <mj-column>
        <mj-button href="{{{{shop_url}}}}" align="left">See everything new</mj-button>
      </mj-column>
    </mj-section>""")

LOYALTY = _email(_band("{{loyalty_points}} points", "Your {{loyalty_tier}} member statement", "#0f766e") + f"""
    <mj-section background-color="#ffffff" padding="28px 24px 8px">
      <mj-column>
        <mj-text>Hi {{{{first_name}}}},</mj-text>
        <mj-text>You have <strong>{{{{loyalty_points}}}} points</strong> ready to use, and your <strong>{{{{loyalty_tier}}}}</strong> benefits are active.</mj-text>
      </mj-column>
    </mj-section>
    <mj-section background-color="#ffffff" padding="8px 24px">
      <mj-group>
        <mj-column background-color="#f0fdfa" border-radius="10px" padding="10px"><mj-text align="center" font-size="13px" color="{MUTED}">Your tier</mj-text><mj-text align="center" font-size="20px" font-weight="700" color="#0f766e">{{{{loyalty_tier}}}}</mj-text></mj-column>
        <mj-column background-color="#f0fdfa" border-radius="10px" padding="10px"><mj-text align="center" font-size="13px" color="{MUTED}">Points balance</mj-text><mj-text align="center" font-size="20px" font-weight="700" color="#0f766e">{{{{loyalty_points}}}}</mj-text></mj-column>
      </mj-group>
    </mj-section>
    <mj-section background-color="#ffffff" padding="16px 24px 32px">
      <mj-column>
        <mj-button href="{{{{shop_url}}}}" background-color="#0f766e" align="left">Use my points</mj-button>
      </mj-column>
    </mj-section>""")

WINBACK = _email(_band("We miss you, {{first_name}}", "It has been a while. Here is something to welcome you back.", "#7c3aed") + f"""
    <mj-section background-color="#ffffff" padding="28px 24px 32px">
      <mj-column>
        <mj-text>A lot has changed since your last visit: new arrivals, easier returns and faster delivery.</mj-text>
        <mj-text>Come back this month and take <strong>{{{{discount_pct}}}}% off</strong> your next order with code <strong>{{{{offer_code}}}}</strong>.</mj-text>
        <mj-button href="{{{{shop_url}}}}" background-color="#7c3aed" align="left">See what is new</mj-button>
        <mj-text font-size="13px" color="{MUTED}">Not interested any more? No hard feelings: use the unsubscribe link below and we will stop.</mj-text>
      </mj-column>
    </mj-section>""")

STORE_RECEIPT = _email(f"""    <mj-section background-color="#ffffff" padding="8px 24px 0">
      <mj-column>
        <mj-text font-size="24px" line-height="32px" font-weight="700" color="{INK}">Thanks for shopping with us, {{{{first_name}}}}</mj-text>
        <mj-text color="{MUTED}">{{{{store_name}}}} &#183; {{{{store_address}}}}</mj-text>
        <mj-text color="{MUTED}">Receipt {{{{receipt_number}}}} &#183; {{{{transaction_date}}}}</mj-text>
        <mj-divider border-width="1px" border-color="#e5e8f0" padding="12px 0" />
        <mj-text font-size="13px" color="{MUTED}" text-transform="uppercase" letter-spacing="1px">Items</mj-text>
        <mj-text>{{{{receipt_body}}}}</mj-text>
        <mj-divider border-width="1px" border-color="#e5e8f0" padding="12px 0" />
      </mj-column>
    </mj-section>
""" + _row("Subtotal", "{{subtotal}}") + _row("Discounts", "{{discount_total}}") + _row("Tax", "{{tax_total}}") + _row("Total", "{{grand_total}}", bold=True)
    + _row("Paid with", "{{payment_method}}") + f"""
    <mj-section background-color="#ffffff" padding="16px 24px 28px">
      <mj-column>
        <mj-divider border-width="1px" border-color="#e5e8f0" padding="4px 0 12px" />
        <mj-text>You now have <strong>{{{{loyalty_points}}}} points</strong> as a {{{{loyalty_tier}}}} member.</mj-text>
      </mj-column>
    </mj-section>""", footer=RECEIPT_FOOTER)

ORDER_CONFIRMATION = _email(_band("Order confirmed", "Order {{order_number}} is on its way to being packed.", "#0369a1") + f"""
    <mj-section background-color="#ffffff" padding="28px 24px 0">
      <mj-column>
        <mj-text>Hi {{{{first_name}}}}, thanks for your order. We will email you again when it ships.</mj-text>
        <mj-text><strong>Estimated delivery:</strong> {{{{delivery_estimate}}}}<br /><strong>Shipping to:</strong> {{{{shipping_address}}}}</mj-text>
        <mj-button href="{{{{order_url}}}}" background-color="#0369a1" align="left">Track my order</mj-button>
        <mj-divider border-width="1px" border-color="#e5e8f0" padding="12px 0" />
        <mj-text font-size="13px" color="{MUTED}" text-transform="uppercase" letter-spacing="1px">Order summary</mj-text>
        <mj-text>{{{{receipt_body}}}}</mj-text>
        <mj-divider border-width="1px" border-color="#e5e8f0" padding="12px 0" />
      </mj-column>
    </mj-section>
""" + _row("Subtotal", "{{subtotal}}") + _row("Tax", "{{tax_total}}") + _row("Total", "{{grand_total}}", bold=True) + _row("Paid with", "{{payment_method}}") + """
    <mj-section background-color="#ffffff" padding="0 24px 24px"><mj-column><mj-spacer height="8px" /></mj-column></mj-section>""", footer=RECEIPT_FOOTER)

STARTERS = [
    {"key": "welcome", "name": "Welcome email", "channel": "EMAIL", "category": "Onboarding",
     "description": "Greets a new member and sets out the benefits of joining.",
     "subject_line": "Welcome to Your Brand, {{first_name}}", "preheader": "Here is what membership gets you.", "mjml": WELCOME},
    {"key": "promotion", "name": "Sale announcement", "channel": "EMAIL", "category": "Promotion",
     "description": "A time-limited offer with a personal discount code.",
     "subject_line": "{{first_name}}, {{discount_pct}}% off this weekend only", "preheader": "Your personal code is inside.", "mjml": PROMOTION},
    {"key": "newsletter", "name": "Monthly newsletter", "channel": "EMAIL", "category": "Newsletter",
     "description": "Three short stories, each with one link.",
     "subject_line": "What is new this month", "preheader": "Three things worth your time.", "mjml": NEWSLETTER},
    {"key": "loyalty", "name": "Loyalty statement", "channel": "EMAIL", "category": "Loyalty",
     "description": "Points balance and tier, with a nudge to redeem.",
     "subject_line": "{{first_name}}, you have {{loyalty_points}} points to use", "preheader": "Your {{loyalty_tier}} benefits are active.", "mjml": LOYALTY},
    {"key": "winback", "name": "Win-back offer", "channel": "EMAIL", "category": "Retention",
     "description": "Re-engages customers who have not bought for a while.",
     "subject_line": "We miss you, {{first_name}}", "preheader": "{{discount_pct}}% off to welcome you back.", "mjml": WINBACK},
    {"key": "store_receipt", "name": "In-store purchase receipt", "channel": "E_RECEIPT", "category": "E-receipt",
     "description": "Point-of-sale receipt: store, items, totals, payment and points earned.",
     "subject_line": "Your receipt from {{store_name}}", "preheader": "Receipt {{receipt_number}} for {{grand_total}}", "mjml": STORE_RECEIPT},
    {"key": "order_confirmation", "name": "Online order confirmation", "channel": "E_RECEIPT", "category": "E-receipt",
     "description": "E-commerce order: delivery estimate, tracking link and order summary.",
     "subject_line": "Order {{order_number}} confirmed", "preheader": "Estimated delivery {{delivery_estimate}}", "mjml": ORDER_CONFIRMATION},
    {"key": "sms_promotion", "name": "SMS offer", "channel": "SMS", "category": "Promotion",
     "description": "One-part promotional text with a code and opt-out wording.",
     "sms_body": "Your Brand: Hi {{first_name}}, {{discount_pct}}% off this weekend with code {{offer_code}}. Shop {{shop_url}} Reply STOP to opt out."},
    {"key": "sms_points", "name": "SMS points reminder", "channel": "SMS", "category": "Loyalty",
     "description": "Reminds a member of their points balance.",
     "sms_body": "Your Brand: {{first_name}}, you have {{loyalty_points}} points as a {{loyalty_tier}} member. Use them at {{shop_url}} Reply STOP to opt out."},
    {"key": "mms_lookbook", "name": "MMS lookbook", "channel": "MMS", "category": "Promotion",
     "description": "Picture message announcing a new collection. Add your picture before activating.", "subject_line": "New season",
     "sms_body": "Your Brand: {{first_name}}, the new season lookbook is here. See it all at {{shop_url}} Reply STOP to opt out."},
]
BY_KEY = {starter["key"]: starter for starter in STARTERS}

# Tags the starters use that a tenant's catalogue may not have yet (key, label, source, path, type, channels, sample).
REQUIRED_TAGS = [
    ("receipt_number", "Receipt number", "RECEIPT", "receipt.number", "STRING", ["E_RECEIPT"], "R-104-88213"),
    ("transaction_date", "Transaction date", "RECEIPT", "receipt.transaction_at", "DATE", ["E_RECEIPT"], "Sep 17, 2026, 4:12 PM"),
    ("store_name", "Store name", "STORE", "name", "STRING", ["E_RECEIPT"], "Your Brand Lenox Square"),
    ("store_address", "Store address", "STORE", "address", "STRING", ["E_RECEIPT"], "3393 Peachtree Rd NE, Atlanta, GA"),
    ("subtotal", "Subtotal", "RECEIPT", "receipt.subtotal", "NUMBER", ["E_RECEIPT"], "$84.00"),
    ("discount_total", "Discounts", "RECEIPT", "receipt.discount_total", "NUMBER", ["E_RECEIPT"], "-$16.80"),
    ("tax_total", "Tax", "RECEIPT", "receipt.tax_total", "NUMBER", ["E_RECEIPT"], "$5.38"),
    ("grand_total", "Total", "RECEIPT", "receipt.grand_total", "NUMBER", ["E_RECEIPT"], "$72.58"),
    ("payment_method", "Payment method", "RECEIPT", "receipt.tender_summary", "STRING", ["E_RECEIPT"], "Visa ending 4242"),
    ("order_number", "Order number", "RECEIPT", "receipt.order_number", "STRING", ["E_RECEIPT"], "NW-2026-104882"),
    ("order_url", "Order tracking URL", "RECEIPT", "receipt.order_url", "STRING", ["E_RECEIPT"], "https://shop.example.com/orders/NW-2026-104882"),
    ("shipping_address", "Shipping address", "RECEIPT", "receipt.shipping_address", "STRING", ["E_RECEIPT"], "18 Oak Lane, Decatur, GA 30030"),
    ("delivery_estimate", "Delivery estimate", "RECEIPT", "receipt.delivery_estimate", "STRING", ["E_RECEIPT"], "Tuesday, Sep 22"),
]


@lru_cache(maxsize=None)
def preview_html(key: str) -> str:
    return design.render_mjml(BY_KEY[key]["mjml"])


def catalogue(channel: str | None = None) -> list[dict]:
    rows = []
    for starter in STARTERS:
        if channel and starter["channel"] != channel:
            continue
        is_email = "mjml" in starter
        rows.append({"key": starter["key"], "name": starter["name"], "channel": starter["channel"], "category": starter["category"],
                     "description": starter["description"], "subject_line": starter.get("subject_line", ""), "preheader": starter.get("preheader", ""),
                     "html_content": preview_html(starter["key"]) if is_email else None, "sms_body": starter.get("sms_body")})
    return rows


# What barcode and QR code blocks read: list-upload columns (member.custom_value_pairs). Patch 0024 adds them to every
# workspace that existed then; onboarding adds them to every new one.
COUPON_TAGS = [
    ("coupon_code", "Coupon Code", "CAMPAIGN_LIST_MEMBER", "custom_value_pairs.coupon_code", "STRING", ["EMAIL", "E_RECEIPT", "SMS", "MMS"], "SAVE20-7K3Q"),
    ("coupon_barcode_value", "Coupon Barcode Value", "CAMPAIGN_LIST_MEMBER", "custom_value_pairs.coupon_barcode_value", "STRING", ["EMAIL", "E_RECEIPT"], "CPN400012345678"),
    ("coupon_qr_value", "Coupon QR Value", "CAMPAIGN_LIST_MEMBER", "custom_value_pairs.coupon_qr_value", "STRING", ["EMAIL", "E_RECEIPT"], "https://shop.example.com/c/SAVE20-7K3Q"),
]


def ensure_coupon_tags(tenant_id, user_id=None, using: str | None = None) -> int:
    manager = PersonalizationTag.objects.using(using) if using else PersonalizationTag.objects
    existing = set(manager.filter(tenant_id=tenant_id, tag_key__in=[row[0] for row in COUPON_TAGS]).values_list("tag_key", flat=True))
    missing = [row for row in COUPON_TAGS if row[0] not in existing]
    manager.bulk_create([
        PersonalizationTag(tenant_id=tenant_id, tag_key=key, label=label, tag_kind="CUSTOM", source_system="CEP", resolution_source=source,
                           source_path=path, data_type=data_type, applies_to_channels=channels, sample_value=sample, description=label,
                           is_active=True, created_by_id=user_id)
        for key, label, source, path, data_type, channels, sample in missing])
    return len(missing)


def ensure_tags(tenant_id, user_id=None) -> int:
    """Adds the receipt / order tags the starters rely on to a tenant's catalogue. Existing keys are left alone."""
    existing = set(PersonalizationTag.objects.filter(tag_key__in=[row[0] for row in REQUIRED_TAGS]).values_list("tag_key", flat=True))
    missing = [row for row in REQUIRED_TAGS if row[0] not in existing]
    PersonalizationTag.objects.bulk_create([
        PersonalizationTag(tenant_id=tenant_id, tag_key=key, label=label, tag_kind="STANDARD", source_system="CEP", resolution_source=source,
                           source_path=path, data_type=data_type, applies_to_channels=channels, sample_value=sample, description=label,
                           is_active=True, created_by_id=user_id)
        for key, label, source, path, data_type, channels, sample in missing])
    return len(missing)


def apply(template, user_id, key: str) -> dict:
    """Version 1 of a freshly created template, saved through the same path as the editors (server render, tag sync)."""
    starter = BY_KEY.get(key)
    if starter is None:
        raise ValidationError({"starter": "Unknown starter."})
    if starter["channel"] != template.channel:
        raise ValidationError({"starter": f"The {starter['name']} starter is for {starter['channel']} templates."})
    ensure_tags(template.tenant_id, user_id)
    if "mjml" in starter:
        return design.save_design(template, user_id, editor_state={"kind": "starter", "starter": key}, mjml_source=starter["mjml"],
                                  subject_line=starter.get("subject_line", ""), preheader=starter.get("preheader", ""), base_version=0)
    return design.save_message(template, user_id, sms_body=starter["sms_body"], subject_line=starter.get("subject_line", ""),
                               media_asset=None, base_version=0)
