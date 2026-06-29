"""High-level exporter that writes viewer_data.json for the web viewer."""

import functools
import os
import pathlib
import tempfile
import threading
import webbrowser
from typing import Any, Optional

from ._base import GeoXplainBase
from .exporter import (
    DEFAULT_APP_SUBTITLE,
    DEFAULT_APP_TITLE,
    DEFAULT_TARGET_COLOR,
    export,
)
from ._screenshot import (
    capture_viewer_screenshot,
    normalize_screenshot_dimensions,
    resolve_screenshot_path,
)
from ._static_server import (
    _StaticFileHTTPServer,
    _StaticFileRequestHandler,
    _copy_browser_bundle,
)

_BROWSER_BUNDLE_MISSING_HINT = (
    'Build the frontend browser bundle before calling GeoXplain.open().'
)


class _OpenRequestHandler(_StaticFileRequestHandler):
    """Silent static handler for the temporary ``GeoXplain.open()`` server."""


class _OpenHTTPServer(_StaticFileHTTPServer):
    pass


class GeoXplainOpenHandle:
    """Handle returned by :meth:`GeoXplain.open`."""

    def __init__(
        self,
        *,
        url: str,
        server: _OpenHTTPServer,
        thread: threading.Thread,
        temporary_directory: tempfile.TemporaryDirectory,
    ) -> None:
        self.url = url
        self._server: _OpenHTTPServer | None = server
        self._thread: threading.Thread | None = thread
        self._temporary_directory: tempfile.TemporaryDirectory | None = temporary_directory

    def close(self) -> None:
        """Stop the local static server and remove its temporary files."""
        server = self._server
        thread = self._thread
        temporary_directory = self._temporary_directory
        self._server = None
        self._thread = None
        self._temporary_directory = None

        if server is not None:
            server.shutdown()
            server.server_close()
        if thread is not None:
            thread.join(timeout=1.0)
        if temporary_directory is not None:
            temporary_directory.cleanup()

    def __enter__(self) -> 'GeoXplainOpenHandle':
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        self.close()


def _start_open_server(
    directory: pathlib.Path,
    temporary_directory: tempfile.TemporaryDirectory,
) -> GeoXplainOpenHandle:
    handler = functools.partial(
        _OpenRequestHandler,
        directory=os.fspath(directory),
    )
    server = _OpenHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(
        target=server.serve_forever,
        name=f'geoxplain-open-{server.server_port}',
        daemon=True,
    )
    thread.start()
    return GeoXplainOpenHandle(
        url=f'http://127.0.0.1:{server.server_port}/index.html',
        server=server,
        thread=thread,
        temporary_directory=temporary_directory,
    )


class GeoXplain(GeoXplainBase):
    """Build, export, and serve a standalone GeoXplain viewer.

    By default the viewer keeps everything in memory: nothing is written to
    disk until you call :meth:`open` (temporary browser preview),
    :meth:`export` (an explicit ``viewer_data.json``), or
    :meth:`export_browser` (a self-contained browser bundle). Pass
    ``out_path`` to opt into the legacy behavior where every data mutation
    re-writes that JSON file.

    Multiple methods and timestamps can be accumulated before opening the
    packaged browser application or capturing a screenshot.

    Parameters
    ----------
    out_path:
        Optional ``viewer_data.json`` path that each mutation keeps in sync.
        When ``None`` (the default) the viewer never touches the filesystem on
        its own; use :meth:`open`, :meth:`export`, or :meth:`export_browser`
        instead.
    title:
        Non-empty application title.
    subtitle:
        Optional subtitle; ``None`` or an empty string hides it.
    target_color:
        CSS color used for target points and boxes.
    colormap:
        Default attribution preset or custom color stops.
    contours:
        Whether attribution starts in contour mode.
    absolute:
        Whether attribution starts showing absolute magnitude instead of
        signed/diverging values.
    result:
        Optional ``XiaResult``-compatible object to add immediately.

    Examples
    --------
    >>> from geoxplain import GeoXplain
    >>> viewer = GeoXplain()
    >>> viewer.add_attribution(
    ...     "saliency_700hPa.npy",
    ...     pressure_level=700,
    ...     method="Saliency",
    ... )
    """

    def __init__(
        self,
        out_path: str | os.PathLike[str] | None = None,
        *,
        title: str = DEFAULT_APP_TITLE,
        subtitle: str | None = DEFAULT_APP_SUBTITLE,
        target_color: str = DEFAULT_TARGET_COLOR,
        colormap: Any = 'default',
        contours: Optional[bool] = None,
        absolute: Optional[bool] = None,
        result: Any = None,
    ) -> None:
        self._out_path = out_path
        self._init_base_state(
            title=title,
            subtitle=subtitle,
            target_color=target_color,
            colormap=colormap,
            contours=contours,
            absolute=absolute,
        )
        if result is not None:
            self.add_attribution(result, colormap=self._colormap)

    @property
    def export_path(self) -> pathlib.Path | None:
        """Configured ``viewer_data.json`` path, or ``None`` when in-memory only."""
        return None if self._out_path is None else pathlib.Path(self._out_path)

    def _export_to_path(self, out_path: str | os.PathLike[str]) -> pathlib.Path:
        path = pathlib.Path(out_path)
        export(
            self._methods,
            os.fspath(path),
            target_color=self._target_color,
            title=self._title,
            subtitle=self._subtitle,
            overlays_data=self._overlays,
            contours=self._contours,
            absolute=self._absolute,
            viewer_options=self._viewer_options,
        )
        return path

    def export(self, out_path: str | os.PathLike[str] | None = None) -> pathlib.Path:
        """Write the current state as ``viewer_data.json``.

        Parameters
        ----------
        out_path:
            Destination path. When omitted, the ``out_path`` supplied to the
            constructor is used. A path is required: if neither is set, call
            :meth:`open` to preview in a browser or :meth:`export_browser` to
            write a self-contained bundle instead.

        Returns
        -------
        pathlib.Path
            The written JSON path.

        Raises
        ------
        ValueError
            If no ``out_path`` is given and none was supplied to the
            constructor.
        """
        target = self._out_path if out_path is None else out_path
        if target is None:
            raise ValueError(
                'No export path configured. Pass an explicit path, e.g. '
                "viewer.export('exports/viewer_data.json'); or use "
                'viewer.open() to preview in a browser, or '
                "viewer.export_browser('exports/my_case') to write a "
                'self-contained browser bundle.'
            )
        return self._export_to_path(target)

    def export_browser(self, out_dir: str | os.PathLike[str]) -> pathlib.Path:
        """Write a self-contained static browser bundle to *out_dir*.

        Copies the packaged browser application into *out_dir* and writes the
        current state next to it as ``viewer_data.json``. The result can be
        served by any static file host (``out_dir`` and everything under it).

        Parameters
        ----------
        out_dir:
            Destination directory. Created if it does not exist.

        Returns
        -------
        pathlib.Path
            Path to the bundle's ``index.html``.
        """
        directory = pathlib.Path(out_dir)
        _copy_browser_bundle(directory, hint=_BROWSER_BUNDLE_MISSING_HINT)
        self._export_to_path(directory / 'viewer_data.json')
        return directory / 'index.html'

    def _sync(self) -> None:
        if self._out_path is not None:
            self._export_to_path(self._out_path)

    def remove_export(self) -> 'GeoXplain':
        """Delete the configured JSON export and return this viewer.

        A no-op when no ``out_path`` was configured. In-memory attributions and
        overlays are never cleared.
        """
        path = self.export_path
        if path is not None:
            path.unlink(missing_ok=True)
        return self

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
        """Capture the current exported viewer data as a PNG screenshot.

        The screenshot contains only the map/globe visualization, attribution,
        targets, and overlays. UI controls are hidden for the capture.

        ``out_path`` may be a file or directory. When omitted, a generated
        filename is placed under ``output_dir``. The optional ``launch_state``
        restores an explicit camera and viewer configuration for the capture.

        Returns
        -------
        pathlib.Path
            The written PNG path.
        """
        path = resolve_screenshot_path(out_path, output_dir)
        screenshot_width, screenshot_height = normalize_screenshot_dimensions(
            width,
            height,
            default_width=1100,
            default_height=820,
        )
        return capture_viewer_screenshot(
            self._build_payload(),
            path,
            width=screenshot_width,
            height=screenshot_height,
            timeout=timeout,
            launch_state=launch_state,
        )

    def open(self, *, open_browser: bool = True) -> GeoXplainOpenHandle:
        """Serve the current viewer export from a temporary local browser build.

        The returned handle owns a temporary directory and a local HTTP server.
        Call ``handle.close()`` when the browser session is no longer needed.

        Parameters
        ----------
        open_browser:
            Open the generated local URL with Python's default browser handler.

        Returns
        -------
        GeoXplainOpenHandle
            Context-manager-compatible owner of the server and temporary files.
        """
        temporary_directory = tempfile.TemporaryDirectory(prefix='geoxplain-open-')
        directory = pathlib.Path(temporary_directory.name)
        try:
            _copy_browser_bundle(directory, hint=_BROWSER_BUNDLE_MISSING_HINT)
            self.export(directory / 'viewer_data.json')
            handle = _start_open_server(directory, temporary_directory)
        except Exception:
            temporary_directory.cleanup()
            raise

        if open_browser:
            try:
                webbrowser.open(handle.url)
            except Exception:
                handle.close()
                raise
        return handle
