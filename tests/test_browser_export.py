"""Unit tests for the "Open in browser" preview-vs-/files decision logic.

These exercise ``_BrowserExportMixin._should_prefer_preview`` /
``_frontend_can_reach_preview`` directly on a bare mixin instance, so they need
no widget construction, no display, and no real sockets.
"""

import geoxplain._browser_export as bx
from geoxplain._browser_export import _BrowserExportMixin, _JupyterPageContext

# A valid Jupyter ``/files`` URL — its exact value is irrelevant to the logic.
_FILES_HREF = '/files/.geoxplain/browser/abc123/index.html'


def _context(origin: str, base_url: str = '/') -> _JupyterPageContext:
    return _JupyterPageContext(
        base_url=base_url,
        origin=origin,
        page_path='lab/tree/Untitled.ipynb',
        notebook_path='Untitled.ipynb',
    )


def _mixin(origin: str, pref: bool | None = None) -> _BrowserExportMixin:
    obj = _BrowserExportMixin.__new__(_BrowserExportMixin)
    obj._jupyter_page_context = _context(origin)
    obj._live_browser_export_pref = pref
    return obj


def _patch_server_origin(monkeypatch, server_origin: str, base_url: str = '/') -> None:
    """Make the Jupyter runtime advertise a single server with *server_origin*."""
    record = {'url': f'{server_origin}/', 'base_url': base_url, 'root_dir': '/workspace'}
    monkeypatch.setattr(bx, '_runtime_server_records', lambda: [record])


def test_prefers_files_when_reached_through_tunnel(monkeypatch):
    # Browser sees 127.0.0.1 but the server is bound to a remote host → forward.
    _patch_server_origin(monkeypatch, 'http://nid007649:8888')
    obj = _mixin('http://127.0.0.1:8888')
    assert obj._should_prefer_preview(_FILES_HREF) is False


def test_prefers_preview_when_truly_local(monkeypatch):
    # Browser and server both on loopback → genuine local session.
    _patch_server_origin(monkeypatch, 'http://localhost:8888')
    obj = _mixin('http://127.0.0.1:8888')
    assert obj._should_prefer_preview(_FILES_HREF) is True


def test_explicit_false_forces_files(monkeypatch):
    # Auto-detect would pick the preview server here; the flag overrides it.
    _patch_server_origin(monkeypatch, 'http://localhost:8888')
    obj = _mixin('http://127.0.0.1:8888', pref=False)
    assert obj._should_prefer_preview(_FILES_HREF) is False


def test_explicit_true_forces_preview(monkeypatch):
    # Auto-detect would pick /files here (tunnel); the flag overrides it.
    _patch_server_origin(monkeypatch, 'http://nid007649:8888')
    obj = _mixin('http://127.0.0.1:8888', pref=True)
    assert obj._should_prefer_preview(_FILES_HREF) is True


def test_no_files_url_always_uses_preview(monkeypatch):
    # With no /files URL available the preview server is the only option, even
    # when the static route was explicitly requested.
    _patch_server_origin(monkeypatch, 'http://nid007649:8888')
    obj = _mixin('http://127.0.0.1:8888', pref=False)
    assert obj._should_prefer_preview(None) is True


def test_vscode_origin_uses_preview(monkeypatch):
    # VSCode forwards detected ports itself, so the preview server is reachable.
    _patch_server_origin(monkeypatch, 'http://nid007649:8888')
    obj = _mixin('vscode-webview://abcdef')
    assert obj._should_prefer_preview(_FILES_HREF) is True
