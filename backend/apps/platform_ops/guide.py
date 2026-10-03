"""The Platform Guide in the back-office: the chapters under docs/manuals/platform-guide, read at request time and rendered
from the Markdown subset the manuals are written in (headings, paragraphs, bullet and numbered lists, tables, block quotes,
fenced code, rules; bold, italics, code and links inline). The same subset frontend/src/help/markdown.tsx renders in the app."""
import re
from functools import lru_cache
from pathlib import Path

from django.conf import settings
from django.utils.html import escape

FOLDER = Path(settings.BASE_DIR).parent / "docs" / "manuals" / "platform-guide"
_INLINE = re.compile(r"(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))")


def chapters() -> list[dict]:
    """[{slug, title, file}] in reading order; the title is the chapter's first H1"""
    out = []
    for path in sorted(FOLDER.glob("*.md")):
        slug = re.sub(r"^\d+-", "", path.stem)
        title = next((line[2:].strip() for line in path.read_text(encoding="utf-8").splitlines() if line.startswith("# ")), slug)
        out.append({"slug": slug, "title": title, "file": path})
    return out


def chapter(slug: str) -> dict | None:
    for item in chapters():
        if item["slug"] == slug:
            return {**item, "html": render(item["file"].read_text(encoding="utf-8"), skip_title=True)}
    return None


# ---------------------------------------------------------------------------------------------------- the renderer
def _inline(text: str) -> str:
    parts = []
    for part in _INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            parts.append(f"<strong>{escape(part[2:-2])}</strong>")
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            parts.append(f"<em>{escape(part[1:-1])}</em>")
        elif part.startswith("`") and part.endswith("`"):
            parts.append(f"<code>{escape(part[1:-1])}</code>")
        else:
            link = re.fullmatch(r"\[([^\]]+)\]\(([^)]+)\)", part)
            if link and (link.group(2).startswith("https://") or link.group(2).startswith("/")):
                parts.append(f'<a href="{escape(link.group(2))}">{escape(link.group(1))}</a>')
            else:
                parts.append(escape(part))
    return "".join(parts)


def _cells(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _is_separator(line: str) -> bool:
    return re.fullmatch(r"\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?", line.strip()) is not None


def _is_item(line: str) -> bool:
    return re.match(r"^\s*([-*]|\d+\.)\s+", line) is not None


@lru_cache(maxsize=64)
def render(source: str, skip_title: bool = False) -> str:
    lines = source.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    html: list[str] = []
    title_skipped = not skip_title
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.strip() == "":
            i += 1
            continue
        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            level = len(heading.group(1))
            if level == 1 and not title_skipped:
                title_skipped = True
            else:
                html.append(f"<h{level}>{_inline(heading.group(2).strip())}</h{level}>")
            i += 1
            continue
        if re.fullmatch(r"(-{3,}|\*{3,})", line.strip()):
            html.append("<hr>")
            i += 1
            continue
        if line.startswith("```"):
            code = []
            i += 1
            while i < len(lines) and not lines[i].startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1
            html.append(f"<pre><code>{escape(chr(10).join(code))}</code></pre>")
            continue
        if line.strip().startswith("|") and i + 1 < len(lines) and _is_separator(lines[i + 1]):
            head = _cells(line)
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                rows.append(_cells(lines[i]))
                i += 1
            thead = "".join(f"<th>{_inline(cell)}</th>" for cell in head)
            tbody = "".join("<tr>" + "".join(f"<td>{_inline(cell)}</td>" for cell in row) + "</tr>" for row in rows)
            html.append(f"<table><thead><tr>{thead}</tr></thead><tbody>{tbody}</tbody></table>")
            continue
        if _is_item(line):
            ordered = re.match(r"^\s*\d+\.", line) is not None
            items: list[str] = []
            while i < len(lines) and (_is_item(lines[i]) or (lines[i].startswith("  ") and items)):
                if _is_item(lines[i]):
                    items.append(re.sub(r"^\s*([-*]|\d+\.)\s+", "", lines[i]))
                else:
                    items[-1] += " " + lines[i].strip()
                i += 1
            tag = "ol" if ordered else "ul"
            html.append(f"<{tag}>" + "".join(f"<li>{_inline(item)}</li>" for item in items) + f"</{tag}>")
            continue
        if line.startswith(">"):
            quote = []
            while i < len(lines) and lines[i].startswith(">"):
                quote.append(re.sub(r"^>\s?", "", lines[i]))
                i += 1
            html.append(f"<blockquote>{_inline(' '.join(quote))}</blockquote>")
            continue
        text = []
        while i < len(lines) and lines[i].strip() != "" and not re.match(r"^#{1,6}\s", lines[i]) and not lines[i].strip().startswith("|") \
                and not _is_item(lines[i]) and not lines[i].startswith("```") and not lines[i].startswith(">"):
            text.append(lines[i].strip())
            i += 1
        html.append(f"<p>{_inline(' '.join(text))}</p>")
    return "\n".join(html)
