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


def word(column: str, text: str) -> str:
    """A condition true when `text` appears in `column` as a whole word, whatever the case or punctuation.

    Plain substring matching is not safe for this. A campaign called "Hottest Designer Deals" contains "test", so
    leaving tests out with LOCATE would quietly drop the biggest send of the year; "Important Update" contains
    "import". Both sides are normalised instead - every run of anything but a letter or a digit becomes one space,
    and the two are padded - so a word matches a word and nothing else. Normalising the word here rather than
    escaping it keeps regular-expression characters out of the statement altogether.
    """
    cleaned = " ".join(re.sub(r"[^0-9a-z]+", " ", (text or "").lower()).split())
    if not cleaned:
        raise OptionError(f"{text!r} has no word to match on.")
    return (f"LOCATE({lit(' ' + cleaned + ' ')}, "
            f"CONCAT(' ', LOWER(REGEXP_REPLACE(COALESCE({column}, ''), '[^0-9a-zA-Z]+', ' ')), ' ')) > 0")
