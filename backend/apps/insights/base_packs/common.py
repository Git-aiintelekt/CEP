"""What every base pack's SQL needs: the names it may put into a statement, and the error when it may not.

A pack builds SQL against a workspace's own database, so the names it is given — a database, a table, a column, a word to
leave out — are the person's, not ours. Nothing reaches a statement without passing through `q` or `lit` first, and a
value that cannot is refused with a message the person can act on rather than quoted into the query.
"""
import re

# A MySQL name as the platforms we read make them, hyphens included (txpostalprod-server-7, citi_analysis_db).
IDENT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_$-]{0,63}$")
# A word a person types to match against campaign names: no quote, wildcard or escape may survive into the SQL.
WORD = re.compile(r"^[^'\"\\%_`;]{1,40}$")


class OptionError(ValueError):
    """An option that cannot go into the SQL; the message is for the person."""


def q(name: str) -> str:
    """A database, table or column name, backquoted."""
    if not IDENT.match(name or ""):
        raise OptionError(f"{name!r} is not a database, table or column name C360 can use.")
    return f"`{name}`"


def lit(text: str) -> str:
    """A short word as a string literal."""
    if not WORD.match(text or ""):
        raise OptionError(f"{text!r} cannot be used: up to 40 characters, without quotes, %, _ or backslashes.")
    return "'" + text + "'"
