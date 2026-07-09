"""Shared public API for GeoXplain frontends."""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from typing import Any, Optional

import numpy as np

from ._progress import _DelayedLayerProgressReporter
from ._validation import (
    _as_preprocess_source,
    _frame_key,
    _normalize_method,
    _normalize_overlay_opacity,
    _normalize_overlay_stretch,
    _normalize_timestamps,
    _snake_to_camel,
)
from ._xia_result_import import iter_xia_result_imports
from .exporter import (
    DEFAULT_APP_SUBTITLE,
    DEFAULT_APP_TITLE,
    DEFAULT_TARGET_COLOR,
    VALID_NORMS,
    _normalize_app_subtitle,
    _normalize_app_title,
    _serialize_target,
    build_json,
    is_valid_level_id,
    normalize_attribution_colormap,
    normalize_overlay_colormap,
)
from .loader import slugify
from .overlay_result import OverlayResultProtocol, overlay_result_to_import
from .preprocessing import preprocess_array
from .xia_result import XiaResultProtocol

_UNSET = object()
_DEFAULT_METHOD_NAME = 'saliency'

# Convenience mapping for pressure-level imports.  Layer keys themselves are
# Aurora-agnostic (``z-{N}``); this table mirrors Aurora's altitude ordering
# (lower hPa = higher altitude = higher N).
_AURORA_LEVELS = (1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50)
_PRESSURE_TO_Z = {hpa: i for i, hpa in enumerate(_AURORA_LEVELS)}

AttributionGrid = str | os.PathLike[str] | np.ndarray
AttributionSource = AttributionGrid | Mapping[str, AttributionGrid] | XiaResultProtocol
RawOverlaySource = str | os.PathLike[str] | np.ndarray
OverlaySource = RawOverlaySource | OverlayResultProtocol


class _DefaultMethod:
    def __repr__(self) -> str:
        return repr(_DEFAULT_METHOD_NAME)


_DEFAULT_METHOD = _DefaultMethod()


class GeoXplainBase:
    """Shared API for standalone and widget GeoXplain viewers."""

    _methods: dict[str, dict]
    _overlays: dict[str, dict]
    _title: str
    _subtitle: str
    _target_color: str
    _colormap: dict[str, Any]
    _contours: bool | None
    _absolute: bool | None
    _normalization: str
    _viewer_options: dict[str, Any]

    def _init_base_state(
        self,
        *,
        title: str = DEFAULT_APP_TITLE,
        subtitle: str | None = DEFAULT_APP_SUBTITLE,
        target_color: str = DEFAULT_TARGET_COLOR,
        colormap: Any = 'default',
        contours: bool | None = None,
        absolute: bool | None = None,
        viewer_options: Mapping[str, Any] | None = None,
    ) -> None:
        self._methods = {}
        self._overlays = {}
        self._title = _normalize_app_title(title)
        self._subtitle = _normalize_app_subtitle(subtitle)
        self._target_color = target_color
        self._colormap = normalize_attribution_colormap(colormap)
        self._contours = contours
        self._absolute = absolute
        self._normalization = 'global'
        self._viewer_options = dict(viewer_options or {})

    def add_attribution(
        self,
        source: AttributionSource,
        *,
        level: str | None = None,
        pressure_level: int | None = None,
        method: str | _DefaultMethod = _DEFAULT_METHOD,
        timestamp: str | None = None,
        target: Any = _UNSET,
        norm: str | None = None,
        label: str | None = None,
        layer_labels: Mapping[str, str] | None = None,
        colormap: Any = None,
    ) -> None:
        """Add attribution data to the viewer.

        Parameters
        ----------
        source:
            A two-dimensional NumPy array, a path to a ``.npy`` grid, a mapping
            from ``"sfc"`` or ``"z-<int>"`` level IDs to grids, or an object
            satisfying :class:`geoxplain.xia_result.XiaResultProtocol`.
        level:
            Level ID for one raw grid. Exactly one of ``level`` and
            ``pressure_level`` is required for a single array or path.
        pressure_level:
            Pressure level in hPa for one raw grid. Supported values are
            1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, and 50.
        method:
            Human-readable method name. Defaults to ``"saliency"`` for raw
            inputs and must not be supplied for a result bundle.
        timestamp:
            Optional frame timestamp for a raw grid or level mapping.
        target:
            Optional point or box accepted by the viewer target serializer.
            Result bundles provide their own targets.
        norm:
            Normalization scope for the attribution color range, applied
            viewer-wide (the last call wins). One of:

            - ``"global"`` — per method, across all its frames (default)
            - ``"all-methods"`` — across every method and frame, for
              comparing attribution magnitudes between methods
            - ``"per-frame"`` — per method, per frame
            - ``"per-frame-all-methods"`` — per frame, across methods
              (frames matched by timestamp)
            - ``"per-level"`` — every level uses its own max

            ``None`` (default) keeps the current setting. The scope can also
            be changed live in the viewer under *Layers → Appearance*.
        label:
            Display label for the single level supplied by an array or path.
        layer_labels:
            Display labels keyed by level ID for a level mapping.
        colormap:
            Attribution preset name or custom color stops. This may override a
            result bundle's display colormap.

        Raises
        ------
        TypeError
            If the source form conflicts with supplied metadata.
        ValueError
            If a level, pressure level, normalization, target, method, or
            colormap is invalid.
        """

        method_was_specified = method is not _DEFAULT_METHOD
        method_name = (
            _DEFAULT_METHOD_NAME
            if method is _DEFAULT_METHOD
            else _normalize_method(method)
        )

        if norm is not None:
            if norm not in VALID_NORMS:
                raise ValueError(f'norm must be one of {VALID_NORMS}. Got: {norm!r}')
            self._normalization = norm

        if isinstance(source, XiaResultProtocol):
            self._reject_xia_result_overrides(
                level=level,
                pressure_level=pressure_level,
                method_was_specified=method_was_specified,
                timestamp=timestamp,
                target=target,
                label=label,
                layer_labels=layer_labels,
            )
            imports = iter_xia_result_imports(
                source,
                consumer_name=self.__class__.__name__,
            )
            total_layers = sum(len(imported.grids) for imported in imports)
            with _DelayedLayerProgressReporter(total_layers) as progress:
                for imported in imports:
                    self._store_attribution_grids(
                        imported.grids,
                        method=imported.label,
                        timestamp=imported.timestamp,
                        target=imported.target,
                        layer_labels=imported.layer_labels,
                        colormap=colormap,
                        _progress_reporter=progress,
                    )
            self._sync()
            return

        if isinstance(source, Mapping):
            if level is not None:
                raise TypeError('level cannot be specified when source is a level mapping.')
            if pressure_level is not None:
                raise TypeError('pressure_level cannot be specified when source is a level mapping.')
            if label is not None:
                raise TypeError('label cannot be specified when source is a level mapping; use layer_labels.')
            self._store_attribution_grids(
                dict(source),
                method=method_name,
                timestamp=timestamp,
                target=target,
                layer_labels=layer_labels,
                colormap=colormap,
            )
            self._sync()
            return

        if isinstance(source, (str, os.PathLike, np.ndarray)):
            if layer_labels is not None:
                raise TypeError('layer_labels cannot be specified for a single attribution grid; use label.')
            level_id, default_label = self._resolve_single_level(level, pressure_level)
            effective_label = label if label is not None else default_label
            self._store_attribution_grids(
                {level_id: source},
                method=method_name,
                timestamp=timestamp,
                target=target,
                layer_labels={level_id: effective_label} if effective_label else None,
                colormap=colormap,
            )
            self._sync()
            return

        raise TypeError(
            'source must be an array, path, level mapping, '
            'or XiaResult-compatible object'
        )

    def clear_attributions(self) -> None:
        """Remove attribution methods, frames, targets, and level data."""
        self._methods = {}
        self._sync()

    def add_overlay(
        self,
        source: OverlaySource,
        *,
        variable: str | None = None,
        name: str | None = None,
        unit: str | None = None,
        colormap: Any = None,
        timestamps: Sequence[str | None] | None = None,
        visible: bool | None = None,
        opacity: float | None = None,
        stretch: tuple[float, float] | Sequence[float] | None = None,
        offset_hours: int | None = None,
        time_label: str | None = None,
    ) -> None:
        """Add a weather overlay to the viewer.

        Parameters
        ----------
        source:
            A two- or three-dimensional NumPy array, a NetCDF path, or an
            object satisfying
            :class:`geoxplain.overlay_result.OverlayResultProtocol`.
        variable:
            NetCDF variable to load. Required for a path and rejected for an
            array or result bundle.
        name:
            Display name. Defaults to the NetCDF variable, ``"Overlay"`` for
            an array, or metadata from a result bundle.
        unit:
            Unit displayed by the viewer.
        colormap:
            ``"viridis"``, ``"plasma"``, ``"thermal"``, ``"sequential"``,
            or custom ``(position, color)`` gradient stops.
        timestamps:
            Optional sequence aligned with the first dimension of a 3-D array.
        visible:
            Whether the overlay starts visible.
        opacity:
            Optional default layer opacity in ``[0, 1]``. When omitted the
            viewer uses its own default (0.7).
        stretch:
            Optional ``(low, high)`` contrast-stretch fractions in ``[0, 1]``
            (the draggable colormap-legend handles). When omitted the viewer
            uses the full range ``(0, 1)``.
        offset_hours:
            Optional integer hours the field data is shifted relative to each
            frame's displayed time (negative = earlier, positive = later). The
            displayed frame is Aurora's most-recent input step t1, so ``-6``
            pulls the prior input step t0 and ``+6`` the forecast valid time t2.
            The viewer annotates it as "… h before/after this frame". For an
            ``OverlayResult`` source it defaults to the bundle's recorded offset.
        time_label:
            Optional free-text annotation the viewer shows next to the offset
            (e.g. ``"Aurora input step t0"`` for ``-6`` or ``"Forecast valid
            time t2"`` for ``+6``). For an ``OverlayResult`` source it defaults
            to the bundle's recorded label.

        Raises
        ------
        TypeError
            If the source form conflicts with ``variable``.
        ValueError
            If required metadata, dimensions, or the colormap is invalid.
        """

        normalized_timestamps = _normalize_timestamps(timestamps)
        normalized_opacity = _normalize_overlay_opacity(opacity)
        normalized_stretch = _normalize_overlay_stretch(stretch)

        if isinstance(source, OverlayResultProtocol):
            if variable is not None:
                raise TypeError(
                    'variable cannot be specified when source is an OverlayResult; '
                    'metadata is taken from the result bundle.'
                )
            imported = overlay_result_to_import(source)
            self._store_overlay_arrays(
                imported.arrays,
                name=name if name is not None else imported.name,
                unit=unit if unit is not None else imported.unit,
                colormap=colormap if colormap is not None else imported.colormap,
                timestamps=normalized_timestamps if normalized_timestamps is not None else imported.timestamps,
                visible=visible if visible is not None else imported.visible,
                opacity=normalized_opacity,
                stretch=normalized_stretch,
                offset_hours=offset_hours if offset_hours is not None else imported.overlay_offset_hours,
                time_label=time_label if time_label is not None else imported.time_label,
            )
            self._sync()
            return

        if isinstance(source, (str, os.PathLike)):
            if variable is None:
                raise ValueError(
                    'variable must be specified when source is a NetCDF path. '
                    'Example: variable="specific_humidity_850hPa"'
                )
            from .netcdf_loader import load_netcdf_variable
            arrays, auto_timestamps = load_netcdf_variable(os.fspath(source), variable)
            self._store_overlay_arrays(
                arrays,
                name=name if name is not None else variable,
                unit=unit if unit is not None else '',
                colormap='viridis' if colormap is None else colormap,
                timestamps=normalized_timestamps if normalized_timestamps is not None else auto_timestamps,
                visible=True if visible is None else visible,
                opacity=normalized_opacity,
                stretch=normalized_stretch,
                offset_hours=offset_hours,
                time_label=time_label,
            )
            self._sync()
            return

        if isinstance(source, np.ndarray):
            if variable is not None:
                raise TypeError('variable cannot be specified when source is a NumPy array.')
            self._store_overlay_arrays(
                source,
                name=name if name is not None else 'Overlay',
                unit=unit if unit is not None else '',
                colormap='viridis' if colormap is None else colormap,
                timestamps=normalized_timestamps,
                visible=True if visible is None else visible,
                opacity=normalized_opacity,
                stretch=normalized_stretch,
                offset_hours=offset_hours,
                time_label=time_label,
            )
            self._sync()
            return

        raise TypeError(
            'source must be an array, NetCDF path, '
            'or OverlayResult-compatible object'
        )

    def clear_overlays(self) -> None:
        """Remove overlays only."""
        self._overlays = {}
        self._sync()

    def set_title(self, title: str) -> None:
        """Set the application title shown in the viewer header."""
        self._title = _normalize_app_title(title)
        self._after_options_changed({'appTitle': self._title})
        self._sync()

    def set_subtitle(self, subtitle: str | None) -> None:
        """Set the optional application subtitle shown below the title."""
        self._subtitle = _normalize_app_subtitle(subtitle)
        self._after_options_changed({'appSubtitle': self._subtitle})
        self._sync()

    def set_options(
        self,
        *,
        view_mode: str | None = None,
        map_type: str | None = None,
        **options: Any,
    ) -> None:
        """Update viewer options using Python-style names.

        Parameters
        ----------
        view_mode:
            ``"heatmap"`` or ``"contours"`` for attribution depiction. For
            backward compatibility, ``"map"`` and ``"globe"`` also select
            the renderer.
        map_type:
            ``"map"`` or ``"globe"`` for the renderer. ``"topo"`` and
            ``"satellite"`` are also accepted as basemap aliases.
        **options:
            Additional frontend options. Common Python names are ``basemap``,
            ``contours``, ``absolute`` (or ``signed`` for the inverse),
            ``smooth`` (or ``smooth_imported_grids``), and
            ``smooth_imported_grid_sigma``. Other snake-case names are
            converted to camel case before being sent to the frontend.
        """
        if view_mode is not None:
            options['view_mode'] = view_mode
        if map_type is not None:
            options['map_type'] = map_type

        frontend_options, contours, absolute = self._normalize_options(options)
        if contours is not _UNSET:
            self._contours = bool(contours)
            self._after_options_changed({'contours': self._contours})

        if absolute is not _UNSET:
            self._absolute = bool(absolute)
            self._after_options_changed({'absolute': self._absolute})

        if frontend_options:
            self._viewer_options.update(frontend_options)
            self._after_options_changed(frontend_options)

        self._sync()

    def clear(self) -> None:
        """Remove attribution and overlay data while keeping configuration."""
        self._methods = {}
        self._overlays = {}
        self._sync()

    def _build_payload(self) -> dict:
        return build_json(
            self._methods,
            target_color=self._target_color,
            title=self._title,
            subtitle=self._subtitle,
            overlays_data=self._overlays,
            contours=self._contours,
            absolute=self._absolute,
            normalization=self._normalization,
            viewer_options=self._viewer_options,
        )

    def _store_attribution_grids(
        self,
        grids: Mapping[str, AttributionGrid],
        *,
        method: str,
        timestamp: Optional[str] = None,
        target: Any = _UNSET,
        layer_labels: Mapping[str, str] | None = None,
        colormap: Any = None,
        _progress_reporter: _DelayedLayerProgressReporter | None = None,
    ) -> None:
        for level_id in grids:
            if not isinstance(level_id, str) or not is_valid_level_id(level_id):
                raise ValueError(
                    f"Unknown level id {level_id!r}. Expected 'sfc' or 'z-<int>'."
                )

        processed: dict[str, np.ndarray] = {}
        for level_id, arr in grids.items():
            if _progress_reporter is not None:
                _progress_reporter.begin_layer()
            try:
                processed[level_id] = preprocess_array(_as_preprocess_source(arr))
            finally:
                if _progress_reporter is not None:
                    _progress_reporter.finish_layer()

        slug = slugify(method)
        method_store = self._methods.setdefault(
            slug,
            {'label': method, 'frames': {}, 'layer_labels': {}},
        )
        method_store['label'] = method
        method_store['color_scheme'] = normalize_attribution_colormap(
            self._colormap if colormap is None else colormap
        )
        if layer_labels:
            method_store.setdefault('layer_labels', {}).update(dict(layer_labels))

        frame = method_store['frames'].setdefault(
            _frame_key(timestamp),
            {'timestamp': timestamp, 'levels': {}},
        )
        if timestamp is not None:
            frame['timestamp'] = timestamp
        if target is not _UNSET:
            frame['target'] = _serialize_target(target)
        for level_id, arr in processed.items():
            frame['levels'][level_id] = arr

    def _store_overlay_arrays(
        self,
        source: np.ndarray,
        *,
        name: str,
        unit: str,
        colormap: Any,
        timestamps: Sequence[str | None] | None,
        visible: bool,
        opacity: float | None = None,
        stretch: tuple[float, float] | None = None,
        offset_hours: int | None = None,
        time_label: str | None = None,
    ) -> None:
        normalized_colormap = normalize_overlay_colormap(colormap)
        normalized_timestamps = _normalize_timestamps(timestamps)
        arr = np.asarray(source, dtype=np.float32)
        if arr.ndim == 2:
            arrays = arr[np.newaxis]
        elif arr.ndim == 3:
            arrays = arr
        else:
            raise ValueError(
                f'source array must be 2-D (H, W) or 3-D (T, H, W). Got shape {arr.shape}'
            )

        overlay_name = name.strip() if isinstance(name, str) and name.strip() else 'Overlay'
        frames: list[dict] = []
        for i, frame_arr in enumerate(arrays):
            processed = preprocess_array(frame_arr)
            ts: Optional[str] = None
            if normalized_timestamps and i < len(normalized_timestamps) and normalized_timestamps[i]:
                ts = str(normalized_timestamps[i])
            frames.append({'arr': processed, 'timestamp': ts})

        self._overlays[slugify(overlay_name)] = {
            'label': overlay_name,
            'unit': unit,
            'colormap': normalized_colormap,
            'visible': bool(visible),
            'opacity': opacity,
            'stretch_low': None if stretch is None else stretch[0],
            'stretch_high': None if stretch is None else stretch[1],
            'offset_hours': None if offset_hours is None else int(offset_hours),
            'time_label': time_label if time_label else None,
            'frames': frames,
        }

    def _reject_xia_result_overrides(
        self,
        *,
        level: str | None,
        pressure_level: int | None,
        method_was_specified: bool,
        timestamp: str | None,
        target: Any,
        label: str | None,
        layer_labels: Mapping[str, str] | None,
    ) -> None:
        if level is not None:
            raise TypeError('level cannot be specified when source is a XiaResult.')
        if pressure_level is not None:
            raise TypeError('pressure_level cannot be specified when source is a XiaResult.')
        if method_was_specified:
            raise TypeError(
                'method cannot be specified when source is a XiaResult; '
                'method labels are taken from the result bundle.'
            )
        if timestamp is not None:
            raise TypeError('timestamp cannot be specified when source is a XiaResult.')
        if target is not _UNSET:
            raise TypeError('target cannot be specified when source is a XiaResult.')
        if label is not None:
            raise TypeError('label cannot be specified when source is a XiaResult.')
        if layer_labels is not None:
            raise TypeError('layer_labels cannot be specified when source is a XiaResult.')

    def _resolve_single_level(
        self,
        level: str | None,
        pressure_level: int | None,
    ) -> tuple[str, str | None]:
        has_level = level is not None
        has_pressure_level = pressure_level is not None
        if has_level == has_pressure_level:
            raise ValueError('exactly one of level or pressure_level must be specified for a single attribution grid.')
        if has_pressure_level:
            if pressure_level not in _PRESSURE_TO_Z:
                raise ValueError(
                    f"Unsupported pressure level {pressure_level} hPa. "
                    f"Supported: {sorted(_PRESSURE_TO_Z.keys())}"
                )
            return f'z-{_PRESSURE_TO_Z[pressure_level]}', f'{pressure_level} hPa'

        if not isinstance(level, str):
            raise TypeError("level must be a string such as 'sfc' or 'z-3'.")
        if not is_valid_level_id(level):
            raise ValueError(f"Unknown level id {level!r}. Expected 'sfc' or 'z-<int>'.")
        return level, None

    def _normalize_options(self, options: Mapping[str, Any]) -> tuple[dict[str, Any], Any, Any]:
        frontend_options: dict[str, Any] = {}
        contours: Any = _UNSET
        absolute: Any = _UNSET

        for raw_key, value in options.items():
            if value is None:
                continue

            key = raw_key.strip() if isinstance(raw_key, str) else raw_key
            if key == 'view_mode':
                value = str(value).strip().lower().replace('_', '-')
                if value == 'contours':
                    contours = True
                elif value == 'heatmap':
                    contours = False
                elif value in {'map', 'globe'}:
                    frontend_options['viewMode'] = value
                else:
                    raise ValueError("view_mode must be 'heatmap', 'contours', 'map', or 'globe'.")
                continue

            if key == 'map_type':
                value = str(value).strip().lower().replace('_', '-')
                if value in {'map', 'globe'}:
                    frontend_options['viewMode'] = value
                elif value in {'topo', 'satellite'}:
                    frontend_options['mapType'] = value
                else:
                    raise ValueError("map_type must be 'map', 'globe', 'topo', or 'satellite'.")
                continue

            if key == 'basemap':
                value = str(value).strip().lower().replace('_', '-')
                if value not in {'topo', 'satellite'}:
                    raise ValueError("basemap must be 'topo' or 'satellite'.")
                frontend_options['mapType'] = value
                continue

            if key in {'contours', 'use_contours'}:
                contours = bool(value)
                continue

            if key in {'absolute', 'absolute_values'}:
                absolute = bool(value)
                continue

            if key == 'signed':
                absolute = not bool(value)
                continue

            if key in {'smooth', 'smooth_imported_grids'}:
                frontend_options['smoothImportedGrids'] = bool(value)
                continue

            if key == 'smooth_imported_grid_sigma':
                frontend_options['smoothImportedGridSigma'] = float(value)
                continue

            if key == 'viewMode':
                value = str(value).strip().lower()
                if value not in {'map', 'globe'}:
                    raise ValueError("viewMode must be 'map' or 'globe'.")
                frontend_options['viewMode'] = value
                continue

            if key == 'mapType':
                value = str(value).strip().lower()
                if value not in {'topo', 'satellite'}:
                    raise ValueError("mapType must be 'topo' or 'satellite'.")
                frontend_options['mapType'] = value
                continue

            if isinstance(key, str):
                frontend_options[_snake_to_camel(key)] = value
            else:
                raise TypeError(f'option names must be strings. Got: {raw_key!r}')

        return frontend_options, contours, absolute

    def _after_options_changed(self, changed_options: Mapping[str, Any]) -> None:
        """Hook for frontends that keep a live options trait."""
        return

    def _sync(self) -> None:
        raise NotImplementedError
