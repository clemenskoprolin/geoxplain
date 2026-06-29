"""Browser-export plumbing for :class:`~geoxplain.widget.GeoXplainWidget`.

This module holds the standalone helpers behind the widget's "Open in Browser"
feature: the local preview HTTP server (with its Server-Sent-Events sync
channel), Jupyter page-context resolution, and the directory/URL bookkeeping
used to write the packaged browser bundle next to a ``viewer_data.json``.

The :class:`~geoxplain.widget.GeoXplainWidget` class keeps the stateful
orchestration; everything here is module-level (no widget instance state) so
the widget module stays focused on the anywidget surface.
"""

from __future__ import annotations

import functools
import json
import logging
import os
import pathlib
import posixpath
import threading
import urllib.parse
import uuid
import warnings
from dataclasses import dataclass

from jupyter_core.paths import jupyter_runtime_dir

from ._static_server import (
    _StaticFileHTTPServer,
    _StaticFileRequestHandler,
    _copy_browser_bundle,
    _write_json_atomic,
)

_DEFAULT_BROWSER_EXPORT_ROOT = pathlib.Path('.geoxplain') / 'browser'
_BROWSER_LIVE_QUERY_PARAM = 'live'
_BROWSER_SYNC_PATH = '/__geoxplain_sync__'
_BROWSER_SYNC_EVENT = 'viewer-data'
_BROWSER_BUNDLE_MISSING_HINT = (
    'Build the frontend browser bundle before using Open in Browser.'
)
_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class _JupyterPageContext:
    base_url: str
    origin: str | None = None
    page_path: str | None = None
    notebook_path: str | None = None


@dataclass(frozen=True)
class _ExportCandidate:
    directory: pathlib.Path | None
    href: str | None
    error: str | None = None


@dataclass
class _LocalBrowserServer:
    directory: pathlib.Path
    server: _PreviewHTTPServer
    thread: threading.Thread
    href: str


class _PreviewRequestHandler(_StaticFileRequestHandler):
    _log_logger = _LOGGER
    _log_prefix = 'GeoXplainWidget preview server: '

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == _BROWSER_SYNC_PATH:
            self._handle_sync_stream()
            return
        super().do_GET()

    def _handle_sync_stream(self) -> None:
        server = self.server
        last_event_id = self._parse_last_event_id(self.headers.get('Last-Event-ID'))
        if last_event_id is None and isinstance(server, _PreviewHTTPServer):
            last_event_id, _ = server.current_update()

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()

        if not isinstance(server, _PreviewHTTPServer):
            return

        try:
            while True:
                event_id, content_hash = server.wait_for_update(last_event_id, timeout=25.0)
                if event_id == last_event_id:
                    self.wfile.write(b': keepalive\n\n')
                    self.wfile.flush()
                    continue

                payload = json.dumps({'contentHash': content_hash}, separators=(',', ':'))
                message = (
                    f'id: {event_id}\n'
                    f'event: {_BROWSER_SYNC_EVENT}\n'
                    f'data: {payload}\n\n'
                )
                self.wfile.write(message.encode('utf-8'))
                self.wfile.flush()
                last_event_id = event_id
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    @staticmethod
    def _parse_last_event_id(value: str | None) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None


class _PreviewHTTPServer(_StaticFileHTTPServer):
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._sync_condition = threading.Condition()
        self._sync_event_id = 0
        self._sync_content_hash = ''

    def current_update(self) -> tuple[int, str]:
        with self._sync_condition:
            return self._sync_event_id, self._sync_content_hash

    def publish_update(self, content_hash: str | None) -> None:
        normalized_hash = content_hash or ''
        with self._sync_condition:
            if self._sync_event_id > 0 and normalized_hash == self._sync_content_hash:
                return
            self._sync_event_id += 1
            self._sync_content_hash = normalized_hash
            self._sync_condition.notify_all()

    def wait_for_update(
        self,
        last_event_id: int | None,
        *,
        timeout: float,
    ) -> tuple[int, str]:
        with self._sync_condition:
            if last_event_id is None or self._sync_event_id > last_event_id:
                return self._sync_event_id, self._sync_content_hash
            self._sync_condition.wait(timeout=timeout)
            return self._sync_event_id, self._sync_content_hash


def _normalize_base_url(value: str | None) -> str:
    if not value:
        return '/'
    parsed = urllib.parse.urlparse(value)
    path = parsed.path or value
    if path in {'', '/'}:
        return '/'
    normalized = f"/{path.strip('/')}"
    return f'{normalized}/'


def _normalize_relative_url_path(value: str | None) -> str | None:
    if not value:
        return None
    stripped = value.strip().strip('/')
    return stripped or None


def _is_loopback_origin(origin: str | None) -> bool:
    if not origin:
        return False
    try:
        hostname = urllib.parse.urlparse(origin).hostname
    except ValueError:
        return False
    if hostname is None:
        return False
    return hostname.lower() in {'127.0.0.1', 'localhost', '::1', '0.0.0.0'}


def _is_vscode_origin(origin: str | None) -> bool:
    if not origin:
        return False
    try:
        parsed = urllib.parse.urlparse(origin)
    except ValueError:
        return False
    scheme = parsed.scheme.lower()
    hostname = (parsed.hostname or '').lower()
    return (
        scheme.startswith('vscode')
        or hostname.endswith('.vscode-cdn.net')
        or hostname == 'vscode-cdn.net'
    )


def _runtime_server_records() -> list[dict]:
    runtime_dir = pathlib.Path(jupyter_runtime_dir())
    records: list[dict] = []
    for path in sorted(runtime_dir.glob('*server-*.json')):
        try:
            payload = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict):
            records.append(payload)
    return records


def _server_origin(record: dict) -> str | None:
    url = record.get('url')
    if not isinstance(url, str) or not url:
        return None
    parsed = urllib.parse.urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f'{parsed.scheme}://{parsed.netloc}'


def _context_server_root(context: _JupyterPageContext | None) -> pathlib.Path | None:
    if context is None:
        return None

    matching: list[pathlib.Path] = []
    for record in _runtime_server_records():
        record_base_url = _normalize_base_url(record.get('base_url'))
        if record_base_url != context.base_url:
            continue
        root_dir = record.get('root_dir') or record.get('notebook_dir')
        if not isinstance(root_dir, str) or not root_dir:
            continue
        candidate = pathlib.Path(root_dir).expanduser()
        if context.origin and _server_origin(record) == context.origin:
            return candidate
        matching.append(candidate)

    if len(matching) == 1:
        return matching[0]

    notebook_path = _normalize_relative_url_path(context.notebook_path)
    if notebook_path:
        notebook_rel = pathlib.PurePosixPath(notebook_path)
        narrowed = [
            root for root in matching
            if (root / pathlib.Path(*notebook_rel.parts)).exists()
        ]
        if len(narrowed) == 1:
            return narrowed[0]

    return None


def _guess_server_root_from_notebook(context: _JupyterPageContext | None) -> pathlib.Path | None:
    if context is None:
        return None
    notebook_path = _normalize_relative_url_path(context.notebook_path)
    if not notebook_path:
        return None

    root = pathlib.Path.cwd().resolve()
    for _ in pathlib.PurePosixPath(notebook_path).parent.parts:
        root = root.parent
    return root


def _resolve_server_root(context: _JupyterPageContext | None) -> pathlib.Path | None:
    return _context_server_root(context) or _guess_server_root_from_notebook(context)


def _relative_dir_to_files_href(
    relative_dir: pathlib.PurePosixPath,
    base_url: str,
) -> str:
    quoted_parts = [urllib.parse.quote(part) for part in relative_dir.parts if part]
    return posixpath.join(base_url, 'files', *quoted_parts, 'index.html')


def _ensure_writable_directory(directory: pathlib.Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    probe = directory / f'.geoxplain_write_check_{uuid.uuid4().hex}'
    probe.write_text('', encoding='utf-8')
    probe.unlink()


def _start_local_browser_server(directory: pathlib.Path) -> _LocalBrowserServer:
    handler = functools.partial(
        _PreviewRequestHandler,
        directory=os.fspath(directory),
    )
    server = _PreviewHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(
        target=server.serve_forever,
        name=f'geoxplain-preview-{server.server_port}',
        daemon=True,
    )
    thread.start()
    return _LocalBrowserServer(
        directory=directory.resolve(),
        server=server,
        thread=thread,
        href=f'http://127.0.0.1:{server.server_port}/index.html',
    )


def _preview_launch_href(href: str) -> str:
    parsed = urllib.parse.urlsplit(href)
    query_items = [
        (key, value)
        for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        if key != _BROWSER_LIVE_QUERY_PARAM
    ]
    query_items.append((_BROWSER_LIVE_QUERY_PARAM, '1'))
    return urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query_items)))


class _BrowserExportMixin:
    """Stateful "Open in Browser" orchestration for ``GeoXplainWidget``.

    The widget owns the relevant instance state (the requested/effective
    directories, the Jupyter page context, the running preview server, and the
    last-warning de-duplication slot); this mixin holds only the methods that
    read and update that state, keeping the widget module focused on the
    anywidget surface. Every attribute and the ``_build_payload`` /
    ``grids_payload`` members referenced here are provided by the concrete
    widget class via the method-resolution order.
    """

    def _warn_once(self, message: str) -> None:
        if message == self._last_browser_warning:
            return
        self._last_browser_warning = message
        warnings.warn(message, stacklevel=2)
        _LOGGER.warning(message)

    def _set_browser_config(self, *, enabled: bool, href: str = '', status: str = '') -> None:
        next_value = {
            'enabled': enabled,
            'href': href,
            'status': status,
        }
        if self.browser_config != next_value:
            self.browser_config = next_value

    def _stop_local_browser_server(self) -> None:
        server = self._local_browser_server
        if server is None:
            return
        self._local_browser_server = None
        server.server.shutdown()
        server.server.server_close()
        server.thread.join(timeout=1.0)

    def _ensure_local_browser_server(self, directory: pathlib.Path) -> tuple[str | None, str | None]:
        resolved_directory = directory.resolve()
        current = self._local_browser_server
        if (
            current is not None
            and current.directory == resolved_directory
            and current.thread.is_alive()
        ):
            return current.href, None

        self._stop_local_browser_server()
        try:
            server = _start_local_browser_server(resolved_directory)
        except OSError as exc:
            return None, f'could not start a local preview server for {resolved_directory}: {exc}'

        self._local_browser_server = server
        _LOGGER.info('GeoXplainWidget preview server running at %s', server.href)
        return server.href, None

    def _publish_local_browser_update(self, payload: dict) -> None:
        server = self._local_browser_server
        if server is None:
            return
        content_hash = payload.get('contentHash')
        server.server.publish_update(content_hash if isinstance(content_hash, str) else '')

    def _href_for_local_dir(self, directory: pathlib.Path) -> str | None:
        context = self._jupyter_page_context
        if context is None:
            return None

        server_root = _resolve_server_root(context)
        if server_root is None:
            return None

        try:
            relative_dir = directory.resolve().relative_to(server_root.resolve())
        except ValueError:
            return None

        return _relative_dir_to_files_href(
            pathlib.PurePosixPath(*relative_dir.parts),
            context.base_url,
        )

    def _default_export_candidate(self) -> _ExportCandidate:
        server_root = _resolve_server_root(self._jupyter_page_context)
        directory = self._cwd_default_browser_dir
        if server_root is not None:
            try:
                directory.resolve().relative_to(server_root.resolve())
            except ValueError:
                directory = server_root / _DEFAULT_BROWSER_EXPORT_ROOT / self._widget_export_id
        return _ExportCandidate(
            directory=directory,
            href=self._href_for_local_dir(directory),
        )

    def _requested_export_candidate(self) -> _ExportCandidate | None:
        if self._requested_config_dir is None:
            return None

        config_text = str(self._requested_config_dir).strip()
        if not config_text:
            return _ExportCandidate(
                directory=None,
                href=None,
                error='config_dir is empty',
            )

        if config_text.startswith('/'):
            relative_dir = pathlib.PurePosixPath(config_text.lstrip('/'))
            if not relative_dir.parts:
                return _ExportCandidate(
                    directory=None,
                    href=None,
                    error=f"config_dir {self._requested_config_dir!r} does not point to a directory",
                )

            server_root = _resolve_server_root(self._jupyter_page_context)
            if server_root is None:
                if self._jupyter_page_context is None:
                    return _ExportCandidate(
                        directory=None,
                        href=None,
                        error='waiting for notebook page context before resolving an absolute Jupyter config_dir',
                    )
                return _ExportCandidate(
                    directory=None,
                    href=None,
                    error='could not determine the Jupyter server root for the requested absolute config_dir',
                )

            return _ExportCandidate(
                directory=server_root.joinpath(*relative_dir.parts),
                href=(
                    _relative_dir_to_files_href(relative_dir, self._jupyter_page_context.base_url)
                    if self._jupyter_page_context is not None
                    else None
                ),
            )

        directory = (pathlib.Path.cwd() / pathlib.Path(config_text)).resolve()
        return _ExportCandidate(
            directory=directory,
            href=self._href_for_local_dir(directory),
        )

    def _prepare_candidate_directory(self, candidate: _ExportCandidate) -> str | None:
        if candidate.directory is None:
            return candidate.error or 'no export directory available'
        try:
            _ensure_writable_directory(candidate.directory)
        except OSError as exc:
            return f'could not create or write {candidate.directory}: {exc}'
        return None

    def _export_payload_to_directory(
        self,
        directory: pathlib.Path,
        payload: dict,
    ) -> tuple[bool, str | None, str | None]:
        browser_bundle_ready = False
        bundle_error: str | None = None

        try:
            _copy_browser_bundle(directory, hint=_BROWSER_BUNDLE_MISSING_HINT)
            browser_bundle_ready = True
        except (FileNotFoundError, OSError) as exc:
            bundle_error = str(exc)

        try:
            _write_json_atomic(directory / 'viewer_data.json', payload)
        except OSError as exc:
            return browser_bundle_ready, f'could not write {directory / "viewer_data.json"}: {exc}', bundle_error

        return browser_bundle_ready, None, bundle_error

    def _frontend_can_reach_preview(self) -> bool:
        """Whether the browser can reach an ad-hoc localhost preview port.

        A loopback frontend origin normally means the browser shares localhost
        with the kernel, so a randomly-chosen preview port is reachable. The
        exception is a remote Jupyter server reached through an SSH
        port-forward: there the browser only sees the *forwarded* Jupyter port
        as ``127.0.0.1`` while the server is really bound to a remote host, and
        arbitrary preview ports are not forwarded. Detect that by comparing the
        frontend origin against the server's own advertised origin; when the
        server is bound to a non-loopback host the preview port is assumed
        unreachable. Falls back to ``True`` (today's behavior) when there is no
        page context or no matching server record to compare against.
        """
        context = self._jupyter_page_context
        if context is None or not _is_loopback_origin(context.origin):
            return False
        for record in _runtime_server_records():
            if _normalize_base_url(record.get('base_url')) != context.base_url:
                continue
            server_origin = _server_origin(record)
            if server_origin and not _is_loopback_origin(server_origin):
                return False
        return True

    def _should_prefer_preview(self, href: str | None) -> bool:
        """Decide between the live preview server and the static ``/files`` URL.

        Honors an explicit ``live_browser_export`` preference (``True`` forces
        the preview server, ``False`` forces ``/files``); otherwise auto-detects
        via :meth:`_frontend_can_reach_preview`. When no ``/files`` URL is
        available (``href is None``) the preview server is the only option, so
        it is always chosen regardless of preference.
        """
        if href is None:
            return True
        preference = getattr(self, '_live_browser_export_pref', None)
        if preference is not None:
            return bool(preference)
        frontend_origin = (
            self._jupyter_page_context.origin
            if self._jupyter_page_context is not None
            else None
        )
        # VSCode forwards detected ports itself, so the preview port is reachable.
        if _is_vscode_origin(frontend_origin):
            return True
        return _is_loopback_origin(frontend_origin) and self._frontend_can_reach_preview()

    def _refresh_browser_export(self, payload: dict | None = None) -> None:
        payload = payload if payload is not None else (
            dict(self.grids_payload) if self.grids_payload else self._build_payload()
        )
        requested = self._requested_export_candidate()
        default = self._default_export_candidate()
        selected = requested or default
        fallback_warning: str | None = None

        if requested is not None:
            requested_error = self._prepare_candidate_directory(requested)
            mapping_error = (
                'it cannot be mapped to a Jupyter /files URL'
                if self._jupyter_page_context is not None and requested.href is None
                else None
            )
            if requested_error or mapping_error:
                reason = requested_error or mapping_error or requested.error or 'it is unavailable'
                if reason != 'waiting for notebook page context before resolving an absolute Jupyter config_dir':
                    fallback_warning = (
                        f"GeoXplainWidget config_dir {self._requested_config_dir!r} is unavailable because {reason}; "
                        f'falling back to {default.directory}.'
                    )
                selected = default

        selected_error = self._prepare_candidate_directory(selected)
        if selected_error:
            status = f'Browser export disabled: {selected_error}'
            if fallback_warning:
                self._warn_once(f'{fallback_warning} {status}')
            else:
                self._warn_once(status)
            self._effective_browser_dir = None
            self._stop_local_browser_server()
            self._set_browser_config(enabled=False, status=status)
            return

        browser_bundle_ready, write_error, bundle_error = self._export_payload_to_directory(selected.directory, payload)
        if write_error and selected.directory != default.directory:
            fallback_message = (
                f"Could not export browser data to {selected.directory}: {write_error}; "
                f'falling back to {default.directory}.'
            )
            fallback_warning = f'{fallback_warning} {fallback_message}'.strip() if fallback_warning else fallback_message
            selected = default
            selected_error = self._prepare_candidate_directory(selected)
            if selected_error:
                status = f'Browser export disabled: {selected_error}'
                self._warn_once(f'{fallback_warning} {status}')
                self._effective_browser_dir = None
                self._stop_local_browser_server()
                self._set_browser_config(enabled=False, status=status)
                return
            browser_bundle_ready, write_error, bundle_error = self._export_payload_to_directory(selected.directory, payload)

        self._effective_browser_dir = selected.directory

        if fallback_warning:
            self._warn_once(fallback_warning)

        if write_error:
            status = f'Browser export disabled: {write_error}'
            self._warn_once(status)
            self._stop_local_browser_server()
            self._set_browser_config(enabled=False, status=status)
            return

        if bundle_error:
            self._warn_once(
                f'Browser export at {selected.directory} wrote viewer_data.json, '
                f'but the standalone browser bundle is unavailable: {bundle_error}'
            )

        if not browser_bundle_ready:
            status = (
                f'Browser export written to {selected.directory}, '
                'but the packaged standalone browser bundle is unavailable.'
            )
            self._stop_local_browser_server()
            self._set_browser_config(enabled=False, status=status)
            return

        href = selected.href
        status = ''
        prefer_preview = self._should_prefer_preview(href)

        if prefer_preview:
            preview_href, preview_error = self._ensure_local_browser_server(selected.directory)
            if preview_href:
                href = _preview_launch_href(preview_href)
                status = (
                    f'Browser export served from a local preview server at {preview_href} '
                    'so Python can push imported-data updates to the browser tab.'
                )
                self._publish_local_browser_update(payload)
            elif href is None:
                self._stop_local_browser_server()
                status = (
                    f'Browser export written to {selected.directory}, '
                    'but this notebook page could not be mapped to a Jupyter /files URL '
                    f'and {preview_error}.'
                )
                self._set_browser_config(enabled=False, status=status)
                return
            else:
                self._stop_local_browser_server()
                status = (
                    f'Browser export available at {href}, '
                    f'but live imported-data syncing is disabled because {preview_error}.'
                )
        else:
            self._stop_local_browser_server()

        self._set_browser_config(enabled=True, href=href or '', status=status)
