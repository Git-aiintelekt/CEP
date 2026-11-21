"""Texts go to the SMS gateway in plain punctuation when that keeps them in the standard alphabet (design.gsm_safe). Rolled back."""

import pytest

pytestmark = [pytest.mark.django_db(databases=["default", "platform"]), pytest.mark.slow]


def test_a_text_goes_to_the_gateway_in_plain_punctuation_when_that_keeps_it_standard(world, check):
    """A curly apostrophe in someone's own data (O’Brien) would turn their whole text into Unicode: 70 characters a part
    instead of 160. Just before the gateway it becomes plain; a text with an emoji is Unicode anyway and keeps its own."""
    p1, p2, _ = world.people[:3]
    world.sql("UPDATE customer_master SET first_name = %s WHERE tenant_id = %s AND party_id = %s", ["O’Brien​", world.tenant, p1])
    world.sql("UPDATE customer_master SET first_name = %s WHERE tenant_id = %s AND party_id = %s", ["Zoë — VIP", world.tenant, p2])
    body = world.template("ZS plain text", "SMS", body="ZS: Hi {{first_name}}, your offer is here. Reply STOP to opt out.")
    cid = world.drip("ZS plain", "SMS", [(0, body, {})], lists=[world.three])
    world.publish(cid)
    world.send(cid, 0)
    sent = dict(world.sql("""SELECT x.party_id, x.rendered_text FROM sms_execution x JOIN campaign_run r ON r.id = x.campaign_run_id
                              WHERE x.tenant_id = %s AND r.campaign_id = %s""", [world.tenant, cid], True))
    segments = dict(world.sql("""SELECT x.party_id, x.segment_count FROM sms_execution x JOIN campaign_run r ON r.id = x.campaign_run_id
                                  WHERE x.tenant_id = %s AND r.campaign_id = %s""", [world.tenant, cid], True))
    check("the curly apostrophe and the zero-width space are gone, one part", sent.get(p1, "").startswith("ZS: Hi O'Brien, your offer") and segments.get(p1) == 1, sent.get(p1))
    check("ë is outside the standard alphabet, so that text is Unicode anyway and keeps its long dash as written",
          "Zoë — VIP" in sent.get(p2, ""), sent.get(p2))
    check.done()
