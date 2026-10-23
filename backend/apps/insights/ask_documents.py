"""Documents sent with Ask for a Report (docs/mockups/ask-for-report-data-and-specs.html, option A): a report's spec as a PDF, a Word
file (.docx), an Excel workbook (.xlsx), CSV, text or Markdown, read for the request and never stored. Claude reads a PDF as it is
and OpenAI takes it as a file; a Word file's text is read here from its XML (no new package); an Excel workbook's sheets are read
with openpyxl (the uploads' reader) as tab-separated rows, SHEET_ROWS a sheet at most; CSV, text and Markdown go as text.
"""
import base64
import html
import re
import zipfile
from io import BytesIO
from pathlib import PurePath

from rest_framework.exceptions import ValidationError

DOCUMENTS_MAX = 3
DOCUMENT_BYTES_MAX = 10_000_000
PAGES_MAX = 100                                                     # PDF pages in one request, all documents together: the providers' limit
TEXT_MAX = 300_000                                                  # characters of Word and text documents together, about 75,000 words
ATTACHMENTS_BYTES_MAX = 20_000_000                                  # documents and images together: a third more once base64-encoded, under the providers' 32 MB
WORD_XML_MAX = 50_000_000                                           # a Word file's text part, unpacked
SHEET_ROWS = 500                                                    # rows of each Excel sheet given to the model; a longer sheet says how many were left out
SHEET_COLUMNS = 60
TEXT_KINDS = {".txt": "text", ".text": "text", ".md": "markdown", ".markdown": "markdown", ".csv": "csv"}
KIND_NAMES = {"pdf": "PDF", "word": "Word", "excel": "Excel", "csv": "CSV", "text": "text", "markdown": "Markdown"}
NOTE = ("The person attached {n} document{s} with this request: {names}. Read them as the specification of the report they want: the "
        "measures, groupings, filters, periods, targets and the view they describe. Follow them where the prompt says to; where the prompt "
        "and a document differ, the prompt wins. A spreadsheet's rows show the layout and the kind of values wanted; the report runs on the "
        "catalogue's data, so never copy numbers from a document. If part of a document cannot be built from the catalogue, "
        "draft the rest and say what was left out in \"note\".")


def read_documents(files) -> list[dict]:
    """Uploaded documents as the providers take them: {name, kind, pages | words, data (a PDF, base64) | text}. At most
    DOCUMENTS_MAX, each a PDF, a Word .docx, an Excel .xlsx, CSV, text or Markdown of up to DOCUMENT_BYTES_MAX, with PAGES_MAX pages
    and TEXT_MAX characters across them. ValidationError otherwise."""
    files = list(files or [])
    if len(files) > DOCUMENTS_MAX:
        raise ValidationError({"documents": f"Add up to {DOCUMENTS_MAX} documents."})
    out, pages, chars = [], 0, 0
    for upload in files:
        name = PurePath(getattr(upload, "name", "") or "the document").name[:200]
        raw = upload.read()
        if len(raw) > DOCUMENT_BYTES_MAX:
            raise ValidationError({"documents": f"{name} is {len(raw) / 1_000_000:.1f} MB; a document may be up to {DOCUMENT_BYTES_MAX // 1_000_000} MB."})
        suffix = PurePath(name).suffix.lower()
        if raw.startswith(b"%PDF-"):
            count = pdf_pages(raw)
            pages += count or 0
            if pages > PAGES_MAX:
                raise ValidationError({"documents": f"The PDFs come to more than {PAGES_MAX} pages; send the pages the report needs."})
            out.append({"name": name, "kind": "pdf", "pages": count, "data": base64.b64encode(raw).decode("ascii")})
            continue
        if suffix == ".doc":
            raise ValidationError({"documents": f"{name} is an old Word file: save it as .docx and attach it again."})
        if suffix == ".xls":
            raise ValidationError({"documents": f"{name} is an old Excel file: save it as .xlsx and attach it again."})
        if zipfile.is_zipfile(BytesIO(raw)) and _holds(raw, "xl/workbook.xml"):
            text = excel_text(raw, name)
            kind = "excel"
        elif zipfile.is_zipfile(BytesIO(raw)):
            text = word_text(raw, name)
            kind = "word"
        elif suffix in TEXT_KINDS and b"\x00" not in raw:
            text = raw.decode("utf-8-sig", errors="replace").replace("\r\n", "\n")
            kind = TEXT_KINDS[suffix]
        else:
            raise ValidationError({"documents": f"{name} is not a PDF, Word (.docx), Excel (.xlsx), CSV, text or Markdown file."})
        chars += len(text)
        if chars > TEXT_MAX:
            raise ValidationError({"documents": f"The documents' text comes to more than {TEXT_MAX:,} characters; send the parts the report needs."})
        if not text.strip():
            raise ValidationError({"documents": f"{name} has no text to read."})
        out.append({"name": name, "kind": kind, "words": len(text.split()), "text": text})
    return out


def pdf_pages(raw: bytes) -> int | None:
    """the page count the file declares (its page tree's largest /Count), else its page objects; None when both are compressed away"""
    counts = [int(n) for n in re.findall(rb"/Type\s*/Pages\b[^>]*?/Count\s+(\d+)", raw) + re.findall(rb"/Count\s+(\d+)[^>]*?/Type\s*/Pages\b", raw)]
    if counts:
        return max(counts)
    return len(re.findall(rb"/Type\s*/Page(?![a-zA-Z])", raw)) or None


def _holds(raw: bytes, part: str) -> bool:
    try:
        with zipfile.ZipFile(BytesIO(raw)) as packed:
            return part in packed.namelist()
    except zipfile.BadZipFile:
        return False


def _cell(value) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        text = value.isoformat()
        return text[:-9] if text.endswith("T00:00:00") else text
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return " ".join(str(value).split())


def excel_text(raw: bytes, name: str) -> str:
    """each sheet as '## Sheet: <name>' and its rows tab-separated (values, not formulas), empty rows left out, SHEET_ROWS rows and
    SHEET_COLUMNS columns a sheet at most, with a line saying how many rows were left out"""
    import openpyxl
    try:
        book = openpyxl.load_workbook(BytesIO(raw), read_only=True, data_only=True)
    except Exception:                                                   # noqa: BLE001  a damaged or protected workbook
        raise ValidationError({"documents": f"{name} is not an Excel (.xlsx) workbook C360 can read; save it again, without a password."}) from None
    parts = []
    try:
        for sheet in book.worksheets:
            lines, more = [], 0
            for row in sheet.iter_rows(values_only=True):
                cells = [_cell(v) for v in row[:SHEET_COLUMNS]]
                while cells and not cells[-1]:
                    cells.pop()
                if not cells:
                    continue
                if len(lines) < SHEET_ROWS:
                    lines.append("\t".join(cells))
                else:
                    more += 1
            if lines:
                parts.append(f"## Sheet: {sheet.title}\n" + "\n".join(lines) + (f"\n({more:,} more rows not shown)" if more else ""))
    finally:
        book.close()
    return "\n\n".join(parts)


WORD_TOKENS = re.compile(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>|<w:(?:tab|br|cr)\b[^>]*/>|</w:p>|</w:tc>|</w:tr>")


def word_text(raw: bytes, name: str) -> str:
    """the body's text in reading order: runs joined, paragraphs on their own lines, table cells split by " | " """
    try:
        with zipfile.ZipFile(BytesIO(raw)) as packed:
            info = packed.getinfo("word/document.xml")
            if info.file_size > WORD_XML_MAX:
                raise ValidationError({"documents": f"{name} is too large to read."})
            xml = packed.read(info).decode("utf-8", errors="replace")
    except (KeyError, zipfile.BadZipFile, RuntimeError, NotImplementedError):
        raise ValidationError({"documents": f"{name} is not a Word (.docx) file C360 can read."}) from None
    xml = re.sub(r"<w:tabs>.*?</w:tabs>", "", xml, flags=re.S)        # tab stops, not tabs
    parts = []
    for match in WORD_TOKENS.finditer(xml):
        token = match.group(0)
        if match.group(1) is not None:
            parts.append(html.unescape(match.group(1)))
        elif token == "</w:tc>":
            parts.append(" | ")
        elif token.startswith("<w:tab"):
            parts.append("\t")
        else:
            parts.append("\n")
    text = re.sub(r"\n \| ", " | ", "".join(parts))                    # a cell's paragraph ends inside its row
    text = re.sub(r" \| (?=\n|$)", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def note(documents: list[dict]) -> str:
    def described(d: dict) -> str:
        return f"\"{d['name']}\" ({KIND_NAMES[d['kind']]}, {d['pages']} pages)" if d.get("pages") else f"\"{d['name']}\" ({KIND_NAMES[d['kind']]})"
    names = "; ".join(described(d) for d in documents)
    return NOTE.format(n=len(documents), s="" if len(documents) == 1 else "s", names=names)


def anthropic_blocks(documents: list[dict]) -> list[dict]:
    """the Messages API's document blocks: a PDF as it is, the others as plain text, each titled with its file name"""
    return [{"type": "document", "title": d["name"],
             "source": {"type": "base64", "media_type": "application/pdf", "data": d["data"]} if d["kind"] == "pdf" else {"type": "text", "media_type": "text/plain", "data": d["text"]}}
            for d in documents]


def openai_parts(documents: list[dict]) -> list[dict]:
    """Chat Completions' parts: a PDF as a file, the others as text in a <document> wrapper"""
    return [{"type": "file", "file": {"filename": d["name"], "file_data": f"data:application/pdf;base64,{d['data']}"}} if d["kind"] == "pdf"
            else {"type": "text", "text": f"<document name=\"{d['name']}\">\n{d['text']}\n</document>"} for d in documents]


def read_words(documents: list[dict], images: int) -> dict:
    """what the draft says it read: the documents by name and kind, and the number of images"""
    return {"documents": [{"name": d["name"], "kind": d["kind"], **({"pages": d["pages"]} if d.get("pages") else {}), **({"words": d["words"]} if d.get("words") else {})} for d in documents],
            "images": images}
