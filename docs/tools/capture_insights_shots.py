"""Screenshots of the Insights screens for the user guide (docs/tools/build_insights_guide.js), from the /dev playgrounds:
sample data, no sign-in, no backend. Needs the front-end dev server on http://localhost:5173 (npm run dev in frontend/).
    python docs/tools/capture_insights_shots.py            every shot
    python docs/tools/capture_insights_shots.py pie map    just these
Writes docs/manuals/insights-guide-shots/<name>.png, 1440 wide, with the empty space under the content cut off."""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageChops

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE = "http://localhost:5173"
OUT = Path(__file__).resolve().parents[1] / "manuals" / "insights-guide-shots"

# name: (address, window height)
SHOTS = {
    "editor-wells": ("/dev/insights?layout=wells", 900),
    "editor-steps": ("/dev/insights?layout=steps", 900),
    "view-pivot": ("/dev/insights?view=pivot&across=channel", 760),
    "view-hierarchy": ("/dev/insights?view=hierarchy", 760),
    "compare": ("/dev/insights?compare=1", 760),
    "format": ("/dev/insights?format=1", 760),
    "chart-stacked": ("/dev/insights?view=chart&chart=stacked&across=channel", 820),
    "chart-pie": ("/dev/insights?view=chart&chart=pie&sample=campaigns", 820),
    "chart-treemap": ("/dev/insights?view=chart&chart=treemap&sample=campaigns", 820),
    "chart-kpi": ("/dev/insights?view=chart&chart=kpi&sample=months&target=900000", 820),
    "chart-map": ("/dev/insights?view=chart&chart=map&sample=states", 860),
    "matrix": ("/dev/insights?view=pivot&across=submitted_at&matrix=1&sparklines=1", 820),
    "multiples": ("/dev/insights?view=chart&multiples=channel", 900),
    "formula": ("/dev/data?show=formula", 900),
    "shared-edit": ("/dev/data?show=shared-edit", 900),
    "shared": ("/dev/data?show=shared", 620),
    "params": ("/dev/data?show=params", 620),
    "upload-review": ("/dev/data?show=review", 900),
    "fiscal": ("/dev/data?show=fiscal", 760),
    "dashboard": ("/dev/dashboard", 1500),
    "dashboard-edit": ("/dev/dashboard?edit=1", 1100),
    "dashboard-canvas": ("/dev/dashboard?edit=1&canvas=1", 1100),
    "dashboard-theme": ("/dev/dashboard?theme=navy", 1100),
    "dashboard-phone": ("/dev/dashboard?canvas=1&phone=1", 1300),
    "ask": ("/dev/ask?state=busy", 900),
    "ask-spec": ("/dev/ask?state=spec&demo=attached", 760),
    "ask-unmapped-draft": ("/dev/ask?state=spec&demo=draft", 1300),
    "ask-data-menu": ("/dev/ask?state=spec&demo=menu", 900),
    "ask-building": ("/dev/ask?state=spec&demo=building", 900),
}


MODALS = {"formula", "shared-edit", "upload-review"}                  # shown as the dialog alone
SIDEBAR, TOPBAR = 240, 48                                            # the app's menu and top bar, cut off so the screen itself reads larger


def trim(path: Path, name: str) -> None:
    """the dialog alone for a dialog; else the page without the app's menu and top bar, and without the empty rows under it"""
    image = Image.open(path).convert("RGB")
    if name in MODALS:
        bright = image.convert("L").point(lambda v: 255 if v > 240 else 0)
        box = bright.crop((SIDEBAR, 0, image.width, image.height)).getbbox()
        if box:
            image = image.crop((SIDEBAR + box[0] - 6, max(0, box[1] - 6), SIDEBAR + box[2] + 6, min(image.height, box[3] + 6)))
        image.save(path, optimize=True)
        return
    image = image.crop((SIDEBAR, TOPBAR, image.width, image.height))
    grey = image.convert("L")
    last = 0
    for y in range(grey.height):                                     # the last row with anything on it, past the page's side margins
        low, high = grey.crop((60, y, grey.width - 60, y + 1)).getextrema()
        if high - low > 8:
            last = y
    image.crop((0, 0, image.width, min(image.height, last + 28))).save(path, optimize=True)


def capture(name: str) -> None:
    address, height = SHOTS[name]
    target = OUT / f"{name}.png"
    target.unlink(missing_ok=True)
    for attempt in range(3):                                          # a headless run now and then hangs: a fresh profile and again
        with tempfile.TemporaryDirectory(prefix="cep-shot-", ignore_cleanup_errors=True) as profile:
            try:
                subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", f"--window-size=1440,{height}",
                                "--virtual-time-budget=15000", f"--user-data-dir={profile}", f"--screenshot={target}", BASE + address],
                               capture_output=True, timeout=90, check=False)
            except subprocess.TimeoutExpired:
                subprocess.run(["taskkill", "/F", "/T", "/FI", "WINDOWTITLE eq about:blank"], capture_output=True, check=False)
        if target.exists():
            break
    if not target.exists():
        raise SystemExit(f"{name}: no screenshot (is the dev server up on {BASE}?)")
    trim(target, name)
    print(f"{name}: {Image.open(target).size}")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[1:] or SHOTS:
        capture(name)
