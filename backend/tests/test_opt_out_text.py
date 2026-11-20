"""The {{opt_out_text}} platform tag (patch 0090) satisfies the marketing-text opt-out check, as opt-out words do."""
from apps.templates.design import OPT_OUT_RE


def test_the_opt_out_text_tag_counts_as_opt_out_wording():
    for body in ("Shop now {{opt_out_text}}", "Shop now {{ opt_out_text }}", "Shop now ${opt_out_text}", "Reply STOP to opt out", "Text UNSUBSCRIBE"):
        assert OPT_OUT_RE.search(body), body
    for body in ("Shop {{shop_url}}", "Use code {{offer_code}}"):
        assert not OPT_OUT_RE.search(body), body
