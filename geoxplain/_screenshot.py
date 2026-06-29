"""Shared Playwright screenshot capture for GeoXplain viewers."""

from __future__ import annotations

import functools
import json
import logging
import os
import pathlib
import tempfile
import threading
import urllib.parse
from datetime import datetime
from typing import Any

from ._static_server import (
    _StaticFileHTTPServer,
    _StaticFileRequestHandler,
    _copy_browser_bundle,
    _write_json_atomic,
)

_LOGGER = logging.getLogger(__name__)
_BROWSER_BUNDLE_MISSING_HINT = (
    'Build the frontend browser bundle before taking screenshots.'
)
_STATE_QUERY_PARAM = 'state'
_SCREENSHOT_READY_SELECTOR = '[data-geoxplain-viewer-ready="true"]'

_INSTALL_HINT = (
    'Screenshot capture requires Playwright. Install it with '
    '`pip install "geoxplain[screenshots]"` and then run '
    '`python -m playwright install chromium`.'
)

_SCREENSHOT_CSS = """
html,
body,
#root {
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  overflow: hidden !important;
}

[data-geoxplain-viewer-root] {
  height: 100vh !important;
}

[data-geoxplain-screenshot-exclude] {
  display: none !important;
}

[data-geoxplain-screenshot-surface] {
  min-height: 100vh !important;
}
"""


class _ScreenshotRequestHandler(_StaticFileRequestHandler):
    _log_logger = _LOGGER
    _log_prefix = 'GeoXplain screenshot server: '


class _ScreenshotServer:
    def __init__(self, directory: pathlib.Path) -> None:
        handler = functools.partial(
            _ScreenshotRequestHandler,
            directory=os.fspath(directory),
        )
        self.server = _StaticFileHTTPServer(('127.0.0.1', 0), handler)
        self.thread = threading.Thread(
            target=self.server.serve_forever,
            name=f'geoxplain-screenshot-{self.server.server_port}',
            daemon=True,
        )
        self.thread.start()
        self.href = f'http://127.0.0.1:{self.server.server_port}/index.html'

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=1.0)


def resolve_screenshot_path(
    out_path: str | os.PathLike[str] | None,
    output_dir: str | os.PathLike[str],
) -> pathlib.Path:
    """Resolve and create the target PNG path for a screenshot."""
    if out_path is None:
        directory = pathlib.Path(output_dir)
        stem = datetime.now().strftime('geoxplain-screenshot-%Y%m%d-%H%M%S')
        path = directory / f'{stem}.png'
        counter = 1
        while path.exists():
            path = directory / f'{stem}-{counter}.png'
            counter += 1
    else:
        path = pathlib.Path(out_path)

    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def normalize_screenshot_dimensions(
    width: int | None,
    height: int | None,
    *,
    default_width: int,
    default_height: int,
) -> tuple[int, int]:
    resolved_width = default_width if width is None else width
    resolved_height = default_height if height is None else height

    try:
        resolved_width = int(resolved_width)
        resolved_height = int(resolved_height)
    except (TypeError, ValueError) as exc:
        raise ValueError('screenshot width and height must be positive integers') from exc

    if resolved_width <= 0 or resolved_height <= 0:
        raise ValueError('screenshot width and height must be positive integers')

    return resolved_width, resolved_height


def _screenshot_url(href: str, launch_state: dict[str, Any] | None) -> str:
    if launch_state is None:
        return href
    query = urllib.parse.urlencode({
        _STATE_QUERY_PARAM: json.dumps(launch_state, separators=(',', ':')),
    })
    return f'{href}?{query}'


def _load_playwright():
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise RuntimeError(_INSTALL_HINT) from exc
    return sync_playwright, PlaywrightError


def capture_viewer_screenshot(
    payload: dict[str, Any],
    out_path: str | os.PathLike[str] | pathlib.Path,
    *,
    width: int,
    height: int,
    timeout: float,
    launch_state: dict[str, Any] | None = None,
) -> pathlib.Path:
    """Render a viewer payload in Chromium and write a PNG screenshot."""
    output_path = pathlib.Path(out_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    timeout_ms = max(1, int(float(timeout) * 1000))
    sync_playwright, playwright_error = _load_playwright()

    with tempfile.TemporaryDirectory(prefix='geoxplain-screenshot-') as tmp:
        directory = pathlib.Path(tmp)
        _copy_browser_bundle(directory, hint=_BROWSER_BUNDLE_MISSING_HINT)
        _write_json_atomic(directory / 'viewer_data.json', payload)
        server = _ScreenshotServer(directory)
        try:
            with sync_playwright() as playwright:
                try:
                    browser = playwright.chromium.launch(
                        args=['--use-gl=angle', '--use-angle=swiftshader'],
                    )
                except playwright_error as exc:
                    raise RuntimeError(_INSTALL_HINT) from exc

                try:
                    page = browser.new_page(
                        viewport={'width': width, 'height': height},
                        device_scale_factor=1,
                    )
                    page.goto(_screenshot_url(server.href, launch_state), wait_until='load', timeout=timeout_ms)
                    page.add_style_tag(content=_SCREENSHOT_CSS)
                    page.wait_for_selector(_SCREENSHOT_READY_SELECTOR, timeout=timeout_ms)
                    page.evaluate(
                        """() => new Promise((resolve) => {
                          requestAnimationFrame(() => requestAnimationFrame(resolve))
                        })"""
                    )
                    page.screenshot(path=os.fspath(output_path), timeout=timeout_ms)
                finally:
                    browser.close()
        finally:
            server.close()

    return output_path
