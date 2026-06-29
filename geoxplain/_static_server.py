"""Shared static-file HTTP serving and browser-bundle helpers.

- :class:`_StaticFileRequestHandler` — forces the bundle's MIME types and sends
  ``no-cache`` headers for ``viewer_data.json``.  Logging is silent by default;
  a subclass opts in by setting :attr:`_log_logger` (and optionally
  :attr:`_log_prefix`).
- :class:`_StaticFileHTTPServer` — a threaded server with daemonized worker
  threads and ``allow_reuse_address`` so a port left in ``TIME_WAIT`` rebinds.
- :func:`_copy_browser_bundle` / :func:`_write_json_atomic` — stage the packaged
  bundle and atomically write the payload alongside it.

Feature-specific behavior, e.g. the widget preview's Server-Sent-Events sync
channel, stays in the owning module as a subclass of these base classes.
"""

from __future__ import annotations

import http.server
import json
import logging
import os
import pathlib
import shutil
import tempfile
import urllib.parse

_STATIC_DIR = pathlib.Path(__file__).parent / 'static'
_BROWSER_BUNDLE_DIR = _STATIC_DIR / 'browser'

_STATIC_MIME_TYPES = {
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
}


class _StaticFileRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Static-file handler for the packaged browser bundle.

    Subclasses set :attr:`_log_logger` to emit ``debug`` access logs (with the
    optional :attr:`_log_prefix`); the default of ``None`` keeps the server
    silent, matching stdlib's stderr logging being suppressed.
    """

    protocol_version = 'HTTP/1.1'
    _MIME_TYPES = _STATIC_MIME_TYPES
    #: Logger for access logging; ``None`` (default) keeps the server silent.
    _log_logger: logging.Logger | None = None
    _log_prefix: str = ''

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        logger = self._log_logger
        if logger is not None:
            logger.debug(self._log_prefix + format, *args)

    def guess_type(self, path: str) -> str:
        _, extension = os.path.splitext(path)
        forced_type = self._MIME_TYPES.get(extension.lower())
        if forced_type:
            return forced_type
        return super().guess_type(path)

    def end_headers(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path.endswith('/viewer_data.json') or parsed.path == '/viewer_data.json':
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        super().end_headers()


class _StaticFileHTTPServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def _copy_browser_bundle(destination_dir: pathlib.Path, *, hint: str) -> None:
    """Copy the packaged browser bundle into *destination_dir*.

    *hint* is appended to the error message when the bundle is missing so each
    caller can point at the feature that needs it.
    """
    if not _BROWSER_BUNDLE_DIR.exists():
        raise FileNotFoundError(
            f'Packaged browser bundle not found at {_BROWSER_BUNDLE_DIR}. {hint}'
        )
    shutil.copytree(_BROWSER_BUNDLE_DIR, destination_dir, dirs_exist_ok=True)


def _write_json_atomic(path: pathlib.Path, payload: dict) -> None:
    """Write *payload* to *path* via a temp file + atomic replace.

    The viewer JSON is read concurrently by the local server / browser tab, so
    writing through a temporary file avoids ever exposing a half-written file.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        'w',
        encoding='utf-8',
        dir=path.parent,
        prefix=f'.{path.stem}-',
        suffix='.tmp',
        delete=False,
    ) as handle:
        json.dump(payload, handle, separators=(',', ':'))
        temp_path = pathlib.Path(handle.name)
    temp_path.replace(path)
