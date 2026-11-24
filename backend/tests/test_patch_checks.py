"""The "is the patch there" checks remember a yes for five minutes, never a no: a patch applied right after a check said no counts
at the next request (Use for List Generation was refused on .68 for five minutes after 0097 went in)."""
from django.core.cache import cache

from apps.insights import api, base_reports, databases, meaning


def _answers(*values):
    given = list(values)

    def q(sql, args=()):
        return [{"present": given.pop(0)}]
    return q, given


def test_a_missing_patch_is_asked_again_and_a_present_one_is_remembered(monkeypatch):
    for module, check, key in ((databases, databases._lists_present, "cep:insights:use-for-lists-present"),
                               (databases, databases._limits_present, "cep:insights:connection-limits-present"),
                               (api, api.own_component_present, "cep:insights:report-component-present"),
                               (base_reports, base_reports.present, "cep:insights:base-install-present"),
                               (meaning, meaning.present, "cep:insights:benchmark-present")):
        cache.delete(key)
        q, left = _answers(False, True)
        monkeypatch.setattr(module, "_q", q)
        assert check() is False
        assert check() is True, f"{key}: the no was remembered"
        assert left == [] and check() is True, f"{key}: the yes was not remembered"
        cache.delete(key)
