"""Drive the live standalone viewer with Playwright and screenshot each capture.

Flow:
  1. ``viewer_data.json`` is already written (by ``run.py`` via ``GeoXplain``).
  2. Start the Vite dev server (serves ``viewer/public/`` statically).
  3. For every (case, capture) navigate to ``/?state=<json>`` so the viewer
     boots straight into the right method + map framing + smoothing, then
     screenshot the viewport.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from urllib.parse import quote

from playwright.sync_api import sync_playwright

from .cases import Case, launch_state

VIEWER_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "viewer")
PORT = 5181
BASE_URL = f"http://localhost:{PORT}"
VIEWPORT = {"width": 1100, "height": 820}
DEFAULT_SETTLE_MS = 8000


def _npm_executable() -> str:
    candidates = ("npm.cmd", "npm") if os.name == "nt" else ("npm",)
    for candidate in candidates:
        path = shutil.which(candidate)
        if path:
            return path
    raise RuntimeError("npm is required to run the visual test viewer")


def _wait_for_server(url: str, timeout: float = 60.0) -> None:
    deadline = time.time() + timeout
    last_err: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return
        except (urllib.error.URLError, OSError) as exc:  # not up yet
            last_err = exc
            time.sleep(0.5)
    raise RuntimeError(f"Vite dev server did not come up at {url}: {last_err}")


def start_dev_server() -> subprocess.Popen:
    """Launch `npm run dev` on a fixed port and wait until it answers."""
    proc = subprocess.Popen(
        [_npm_executable(), "run", "dev", "--", "--port", str(PORT), "--strictPort"],
        cwd=os.path.abspath(VIEWER_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        _wait_for_server(BASE_URL, timeout=90.0)
    except Exception:
        proc.terminate()
        raise
    return proc


def _state_url(slug: str, capture) -> str:
    state = launch_state(slug, capture)
    return f"{BASE_URL}/?state={quote(json.dumps(state), safe='')}"


def capture_all(
    cases: list[Case],
    out_dir: str,
    settle_ms: int = DEFAULT_SETTLE_MS,
) -> dict[str, str]:
    """Screenshot every capture; return {capture_key: png_path}.

    ``capture_key`` is ``"{slug}__{suffix}"``.
    """
    os.makedirs(out_dir, exist_ok=True)
    results: dict[str, str] = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader"])
        page = browser.new_page(viewport=VIEWPORT, device_scale_factor=1)
        for case in cases:
            for cap in case.captures:
                key = f"{case.slug}__{cap.suffix}"
                page.goto(_state_url(case.slug, cap), wait_until="load")
                # Wait for the WebGL canvas, then let MapLibre tiles + the
                # data-poll (1.5 s) + overlay build settle.
                try:
                    page.wait_for_selector("canvas", timeout=15000)
                except Exception:
                    pass
                page.wait_for_timeout(settle_ms)
                path = os.path.join(out_dir, f"viewer_{key}.png")
                page.screenshot(path=path)
                results[key] = path
                print(f"  captured {key}")
        browser.close()
    return results
