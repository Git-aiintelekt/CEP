"""A grid's Total row (view.totals): the definition keeps the totalled columns it names, the engine is asked for the grand total,
and every export ends the grid with the same row."""
import pytest

from apps.insights import compiler, shape
from apps.insights.definition import DefinitionError, _view

COLUMNS = [{"field": "channel"}, {"field": "campaign_name"}, {"field": "sent", "aggregate": "sum"},
           {"field": "unit", "aggregate": "max"}, {"field": "c_rate", "aggregate": "calc"}]


def test_view_keeps_the_totalled_columns_in_report_order():
    assert _view({"type": "grid", "totals": ["c_rate", "sent"]}, COLUMNS) == {"type": "grid", "totals": ["sent", "c_rate"]}
    assert _view({"type": "grid", "totals": []}, COLUMNS) == {"type": "grid"}


@pytest.mark.parametrize("raw", [
    {"type": "grid", "totals": ["channel"]},               # a dimension
    {"type": "grid", "totals": ["nope"]},                  # not a column
    {"type": "grid", "totals": ["sent", "sent"]},
    {"type": "grid", "totals": "sent"},
    {"type": "pivot", "across": "channel", "totals": ["sent"]},
])
def test_view_refuses_a_bad_total_row(raw):
    with pytest.raises(DefinitionError):
        _view(raw, COLUMNS)


def test_a_grid_with_a_total_row_asks_for_the_grand_total():
    definition = {"columns": COLUMNS}
    assert compiler.totals_sets(definition, {"type": "grid", "totals": ["sent"]}) == [()]
    assert compiler.totals_sets(definition, {"type": "grid"}) is None


def test_grid_total_row():
    columns = [{"key": "channel"}, {"key": "campaign_name"}, {"key": "sent", "aggregate": "sum"},
               {"key": "unit", "aggregate": "max"}, {"key": "c_rate", "aggregate": "calc"}]
    totals = [{"keys": {}, "values": [120, 9.5, 0.25]}]
    view = {"type": "grid", "totals": ["sent", "c_rate"]}
    assert shape.grid_total(columns, totals, view) == ["Total", None, 120, None, 0.25]
    assert shape.grid_total(columns, totals, {"type": "grid"}) is None
    assert shape.grid_total(columns, [{"keys": {"channel": "email"}, "values": [1, 1, 1]}], view) is None
    masked = [dict(c, masked=True) if c["key"] == "sent" else c for c in columns]
    assert shape.grid_total(masked, totals, view) == ["Total", None, None, None, 0.25]


def test_a_grid_holding_every_line_adds_up_its_own_sums():
    from decimal import Decimal

    from apps.insights.runner import _grid_total_of_rows
    columns = [{"key": "channel"}, {"key": "sent", "aggregate": "sum"}, {"key": "unit", "aggregate": "max"}, {"key": "c_rate", "aggregate": "calc"}]
    rows = [["email", Decimal("1.10"), 5, 0.2], ["sms", Decimal("2.20"), 7, 0.4], ["push", None, 1, None]]
    assert _grid_total_of_rows({"type": "grid", "totals": ["sent"]}, columns, rows) == [{"keys": {}, "values": [3.3, None, None]}]
    assert _grid_total_of_rows({"type": "grid", "totals": ["sent", "c_rate"]}, columns, rows) is None      # a calculated column: the engine
    assert _grid_total_of_rows({"type": "grid", "totals": ["unit"]}, columns, rows) is None                # a max: the engine
    assert _grid_total_of_rows({"type": "grid"}, columns, rows) is None
