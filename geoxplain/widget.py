"""Jupyter widget wrapper for the packaged GeoXplain viewer frontend."""

from __future__ import annotations

import os
import pathlib
import uuid
from typing import Any

import traitlets
import anywidget
import ipywidgets

from ._base import GeoXplainBase
from .exporter import (
    DEFAULT_APP_SUBTITLE,
    DEFAULT_APP_TITLE,
    DEFAULT_TARGET_COLOR,
)
from ._screenshot import (
    capture_viewer_screenshot,
    normalize_screenshot_dimensions,
    resolve_screenshot_path,
)
from ._browser_export import (
    _BrowserExportMixin,
    _DEFAULT_BROWSER_EXPORT_ROOT,
    _JupyterPageContext,
    _LocalBrowserServer,
    _normalize_base_url,
    _normalize_relative_url_path,
)

_STATIC_DIR = pathlib.Path(__file__).parent / 'static'


class GeoXplainWidget(_BrowserExportMixin, GeoXplainBase, anywidget.AnyWidget):
    """Interactive Jupyter widget for GeoXplain attribution visualization.

    The widget renders the same globe / map viewer used by the
    standalone browser app, but embedded directly in a notebook cell.

    Parameters
    ----------
    height:
        Cell height in pixels (default 620).
    initial_view_mode:
        Starting render mode — ``'globe'`` or ``'map'``.
    initial_map_type:
        Starting basemap — ``'topo'`` or ``'satellite'``.
    contours:
        Start with the contour-line depiction instead of the filled heatmap
        (default ``False``).  Users can switch styles at any time with the
        contour toggle in the viewer's view controls.
    absolute:
        Start showing absolute magnitude instead of signed/diverging values
        (default ``False``).  Users can switch with the "Signed values" toggle
        in the viewer's Appearance menu.
    smooth:
        Start with imported-grid smoothing enabled (default ``True``).
    config_dir:
        Optional browser-export directory. Relative paths are resolved from the
        kernel working directory; absolute paths are treated as Jupyter
        server-relative paths (for example ``'/exports/my-widget'``).
    live_browser_export:
        How the "Open in browser" button serves the standalone viewer.

        - ``None`` (default): auto-detect. When the notebook page is reached
          through an SSH port-forward — a loopback browser origin while the
          Jupyter server is bound to a remote host — the button is served from
          the Jupyter server's ``/files`` endpoint, reusing the port you
          already forward for the notebook (no extra tunnel). On a genuinely
          local session it instead uses a short-lived local preview server,
          which can also push imported-data updates into an already-open tab.
        - ``True``: always use the live preview server. Choose this on a remote
          session only if you have forwarded the preview server's port yourself
          and want live imported-data syncing.
        - ``False``: always use the static ``/files`` URL. No extra port to
          forward, but an already-open tab is not auto-updated; re-open it to
          refresh.
    title:
        Application title shown in the widget and browser-viewer headers.
    subtitle:
        Optional application subtitle shown under the title. Pass ``None`` or
        an empty string to hide it.
    target_color:
        CSS color used for target points and boxes.
    colormap:
        Default attribution preset or custom color stops.
    result:
        Optional ``XiaResult``-compatible object to add immediately.
    **kwargs:
        Additional keyword arguments forwarded to ``anywidget.AnyWidget``.
    """

    # ── anywidget frontend assets ──────────────────────────────────────────
    _esm = pathlib.Path(_STATIC_DIR / 'widget.js')
    _css = pathlib.Path(_STATIC_DIR / 'widget.css')

    # ── synced traits ──────────────────────────────────────────────────────

    # Heavy: the encoded grid payload — same JSON structure as viewer_data.json.
    # Only changes when the user pushes new data.
    grids_payload = traitlets.Dict({}).tag(sync=True)

    browser_config = traitlets.Dict({
        'enabled': False,
        'href': '',
        'status': '',
    }).tag(sync=True)

    # Lightweight UI defaults — only used as initial values when the widget mounts.
    options = traitlets.Dict({
        'viewMode': 'map',
        'mapType': 'topo',
        'contours': False,
        'absolute': False,
        'appTitle': DEFAULT_APP_TITLE,
        'appSubtitle': DEFAULT_APP_SUBTITLE,
    }).tag(sync=True)

    # Widget display height (px)
    height = traitlets.Int(620).tag(sync=True)

    def __init__(
        self,
        height: int = 620,
        initial_view_mode: str = 'map',
        initial_map_type: str = 'topo',
        contours: bool = False,
        absolute: bool = False,
        smooth: bool = True,
        title: str = DEFAULT_APP_TITLE,
        subtitle: str | None = DEFAULT_APP_SUBTITLE,
        target_color: str = DEFAULT_TARGET_COLOR,
        colormap: Any = 'default',
        config_dir: str | os.PathLike[str] | None = None,
        live_browser_export: bool | None = None,
        result: Any = None,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        # anywidget caches FileContents in-process, so a rebuilt widget bundle
        # is otherwise not picked up until the kernel restarts. Refresh the
        # synced source text for each instance from disk.
        self.set_trait('_esm', (_STATIC_DIR / 'widget.js').read_text(encoding='utf-8'))
        self.set_trait('_css', (_STATIC_DIR / 'widget.css').read_text(encoding='utf-8'))
        self.height = height
        self._init_base_state(
            title=title,
            subtitle=subtitle,
            target_color=target_color,
            colormap=colormap,
            contours=contours,
            absolute=absolute,
            viewer_options={
                'viewMode': initial_view_mode,
                'mapType': initial_map_type,
                'smoothImportedGrids': smooth,
            },
        )
        self.layout = ipywidgets.Layout(
            display='block',
            width='calc(100% + 16px)',
            min_width='320px',
            height=f'{height}px',
            margin='0 -8px',
            overflow='visible',
        )
        self.options = {
            **self._viewer_options,
            'contours': contours,
            'absolute': absolute,
            'appTitle': self._title,
            'appSubtitle': self._subtitle,
        }
        if live_browser_export is not None and not isinstance(live_browser_export, bool):
            raise TypeError('live_browser_export must be True, False, or None')
        self._widget_export_id = uuid.uuid4().hex
        self._requested_config_dir = os.fspath(config_dir) if config_dir is not None else None
        self._live_browser_export_pref = live_browser_export
        self._cwd_default_browser_dir = pathlib.Path.cwd() / _DEFAULT_BROWSER_EXPORT_ROOT / self._widget_export_id
        self._effective_browser_dir: pathlib.Path | None = None
        self._jupyter_page_context: _JupyterPageContext | None = None
        self._local_browser_server: _LocalBrowserServer | None = None
        self._last_browser_warning: str | None = None
        self._last_viewer_launch_state: dict[str, Any] | None = None
        self._last_viewer_surface_size: tuple[int, int] | None = None
        self._last_viewer_ready = False
        self.on_msg(self._handle_frontend_message)
        self._refresh_browser_export()
        if result is not None:
            self.add_attribution(result, colormap=self._colormap)

    # ── public API ─────────────────────────────────────────────────────────

    def _after_options_changed(self, changed_options: dict[str, Any]) -> None:
        self.options = {**self.options, **changed_options}

    def _sync(self) -> None:
        payload = self._build_payload()
        self.grids_payload = payload
        self._refresh_browser_export(payload)

    def screenshot(
        self,
        out_path: str | os.PathLike[str] | None = None,
        *,
        width: int | None = None,
        height: int | None = None,
        output_dir: str | os.PathLike[str] = 'screenshots',
        timeout: float = 30.0,
        launch_state: dict[str, Any] | None = None,
    ) -> pathlib.Path:
        """Capture the widget's current viewer state as a PNG screenshot.

        The screenshot contains only the map/globe visualization, attribution,
        targets, and overlays. UI controls are hidden for the capture.

        When ``width`` or ``height`` is omitted, the latest dimensions reported
        by the rendered widget are used, falling back to 1100 pixels by the
        configured widget height. ``launch_state`` overrides the latest camera
        and viewer state reported by the frontend.

        Returns
        -------
        pathlib.Path
            The written PNG path.
        """
        default_width, default_height = self._last_viewer_surface_size or (1100, int(self.height))
        screenshot_width, screenshot_height = normalize_screenshot_dimensions(
            width,
            height,
            default_width=default_width,
            default_height=default_height,
        )
        path = resolve_screenshot_path(out_path, output_dir)
        effective_launch_state = (
            launch_state
            if launch_state is not None
            else self._last_viewer_launch_state
        )
        payload = dict(self.grids_payload) if self.grids_payload else self._build_payload()
        return capture_viewer_screenshot(
            payload,
            path,
            width=screenshot_width,
            height=screenshot_height,
            timeout=timeout,
            launch_state=effective_launch_state,
        )

    def close(self) -> None:
        """Stop the browser preview server and release widget resources."""
        self._stop_local_browser_server()
        super().close()

    def _handle_frontend_message(
        self,
        _widget: ipywidgets.Widget,
        content: dict,
        _buffers: list[bytes],
    ) -> None:
        if not isinstance(content, dict):
            return
        kind = content.get('kind')
        if kind == 'geoxplain:viewer_state':
            self._handle_viewer_state_message(content)
            return
        if kind != 'geoxplain:jupyter_page_context':
            return

        self._jupyter_page_context = _JupyterPageContext(
            base_url=_normalize_base_url(content.get('baseUrl') if isinstance(content.get('baseUrl'), str) else None),
            origin=(content.get('origin') if isinstance(content.get('origin'), str) else None),
            page_path=_normalize_relative_url_path(content.get('pagePath') if isinstance(content.get('pagePath'), str) else None),
            notebook_path=_normalize_relative_url_path(content.get('notebookPath') if isinstance(content.get('notebookPath'), str) else None),
        )
        self._refresh_browser_export()

    def _handle_viewer_state_message(self, content: dict) -> None:
        launch_state = content.get('launchState')
        if isinstance(launch_state, dict):
            self._last_viewer_launch_state = launch_state

        surface = content.get('surface')
        if isinstance(surface, dict):
            width = surface.get('width')
            height = surface.get('height')
            if isinstance(width, (int, float)) and isinstance(height, (int, float)):
                rounded_width = int(round(width))
                rounded_height = int(round(height))
                if rounded_width > 0 and rounded_height > 0:
                    self._last_viewer_surface_size = (rounded_width, rounded_height)

        ready = content.get('ready')
        if isinstance(ready, bool):
            self._last_viewer_ready = ready
