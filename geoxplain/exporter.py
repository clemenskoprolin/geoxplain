"""Build and write the viewer_data.json consumed by the JS viewer."""

import base64
import hashlib
import json
import os
import warnings
from typing import Any

import numpy as np

from .colormaps import normalize_attribution_colormap, normalize_overlay_colormap
from .levels import (
    default_layer_label,
    is_valid_level_id,  # noqa: F401  re-exported for `from .exporter import is_valid_level_id`
    level_order,
)
from .loader import short_label
from .targets import _serialize_target


def _finite_max_abs(values: np.ndarray) -> float:
    """Largest ``|x|`` over the finite entries of ``values`` (``1.0`` if none).

    Computing the color range with a plain ``.max()`` lets a single ``inf``
    poison the whole normalisation (every finite value then collapses to 0), so
    non-finite samples are excluded here.
    """
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return 1.0
    return float(np.abs(finite).max()) or 1.0


def _finite_values(values: np.ndarray, *, context: str) -> np.ndarray:
    """Return the finite subset of ``values``, warning once if any were dropped.

    Non-finite samples (NaN/±Inf) are ignored when deriving the color range and
    are clamped during quantization (see :func:`_encode_level` /
    :func:`_encode_overlay_frame`) rather than silently corrupting the output.
    """
    finite_mask = np.isfinite(values)
    if not finite_mask.all():
        warnings.warn(
            f'{context} contains non-finite values (NaN/Inf); they are excluded '
            'from the color range and clamped during quantization.',
            stacklevel=3,
        )
    return values[finite_mask]


DEFAULT_TARGET_COLOR = '#06b6d4'
DEFAULT_APP_TITLE = 'GeoXplain'
DEFAULT_APP_SUBTITLE = 'Interactive geospatial attribution viewer'


def _normalize_target_color(target_color: str) -> str:
    if not isinstance(target_color, str):
        raise ValueError(f'target_color must be a string. Got: {target_color!r}')
    normalized = target_color.strip()
    if not normalized:
        raise ValueError('target_color must not be empty.')
    return normalized


def _normalize_app_title(title: str) -> str:
    if not isinstance(title, str):
        raise ValueError(f'title must be a string. Got: {title!r}')
    normalized = title.strip()
    if not normalized:
        raise ValueError('title must not be empty.')
    return normalized


def _normalize_app_subtitle(subtitle: str | None) -> str:
    if subtitle is None:
        return ''
    if not isinstance(subtitle, str):
        raise ValueError(f'subtitle must be a string or None. Got: {subtitle!r}')
    return subtitle.strip()


def _encode_level(
    arr: np.ndarray,
    max_abs: float,
    diverging: bool,
    level_id: str,
    layer_labels: dict[str, str] | None = None,
) -> dict:
    """Normalise one float32 2-D array and return a JSON-ready level dict.

    Diverging:     (arr / max_abs) * 0.5 + 0.5  →  [0, 1], centre 0.5 = zero
    Unidirectional: arr / max_abs               →  [0, 1], 0 = min, 1 = max

    ``z`` is the vertical order (higher renders higher; ``sfc`` is the lowest
    sentinel) and ``label`` is the display name — from *layer_labels* if present,
    otherwise the bare number (``"z-2"`` → ``"2"``) or ``"Surface"``.
    """
    if diverging:
        normalised = (arr / max_abs) * 0.5 + 0.5
        nan_fill = 0.5  # centre (zero) for diverging maps
    else:
        normalised = arr / max_abs  # all values already >= 0
        nan_fill = 0.0  # minimum for unidirectional maps
    # NaN/±Inf survive ``clip`` (NaN→0, +Inf→255) and would silently corrupt the
    # texture, so map them to defined positions before quantizing.
    normalised = np.nan_to_num(normalised, nan=nan_fill, posinf=1.0, neginf=0.0)
    arr_u8 = (normalised * 255).clip(0, 255).astype(np.uint8)
    b64 = base64.b64encode(arr_u8.ravel().tobytes()).decode('ascii')
    label = (layer_labels or {}).get(level_id) or default_layer_label(level_id)
    return {
        'z': level_order(level_id),
        'label': label,
        'shape': list(arr.shape),
        'data_u8_b64': b64,
    }


def _iter_method_frames(mdata: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    frames = mdata.get('frames')
    if isinstance(frames, dict) and frames:
        return [
            (str(frame_key), frame)
            for frame_key, frame in frames.items()
            if isinstance(frame, dict)
        ]
    return [(
        str(mdata.get('timestamp') or '__default__'),
        {
            'timestamp': mdata.get('timestamp'),
            'target': mdata.get('target'),
            'levels': mdata.get('levels', {}),
        },
    )]


VALID_NORMS = ('global', 'per-frame', 'per-level')


def _encode_overlay_frame(arr: np.ndarray, min_val: float, max_val: float, timestamp: str | None) -> dict:
    """Encode one 2-D overlay frame as uint8 with global min/max normalization."""
    range_val = max_val - min_val
    if range_val == 0:
        normalised = np.zeros_like(arr, dtype=np.float32)
    else:
        normalised = (arr - min_val) / range_val
    # NaN/±Inf survive ``clip`` and would corrupt the texture; clamp them first.
    normalised = np.nan_to_num(normalised, nan=0.0, posinf=1.0, neginf=0.0)
    arr_u8 = (normalised * 255).clip(0, 255).astype(np.uint8)
    b64 = base64.b64encode(arr_u8.ravel().tobytes()).decode('ascii')
    payload: dict[str, Any] = {'shape': list(arr.shape), 'data_u8_b64': b64}
    if timestamp:
        payload['timestamp'] = timestamp
    return payload


def _build_overlays_section(overlays_data: dict[str, dict]) -> dict[str, dict]:
    """Encode all overlays and return the JSON-ready ``overlays`` dict."""
    result: dict[str, dict] = {}
    for slug in overlays_data:
        odata = overlays_data[slug]
        frames_store: list[dict] = odata.get('frames', [])
        if not frames_store:
            continue

        # Global min/max across all frames for consistent normalization.
        all_arrs = [f['arr'] for f in frames_store if f.get('arr') is not None]
        if not all_arrs:
            continue
        finite = _finite_values(
            np.concatenate([a.ravel() for a in all_arrs]),
            context=f'overlay {odata.get("label", slug)!r}',
        )
        if finite.size == 0:
            global_min, global_max = 0.0, 1.0
        else:
            global_min = float(finite.min())
            global_max = float(finite.max())
        if global_min == global_max:
            global_max = global_min + 1.0

        encoded_frames = [
            _encode_overlay_frame(f['arr'], global_min, global_max, f.get('timestamp'))
            for f in frames_store
        ]

        colormap = normalize_overlay_colormap(odata.get('colormap', 'viridis'))

        result[slug] = {
            'label': odata['label'],
            'unit': odata.get('unit', ''),
            'colormap': 'custom' if isinstance(colormap, list) else colormap,
            'visible': odata.get('visible', True),
            'minVal': global_min,
            'maxVal': global_max,
            'frames': encoded_frames,
        }
        if isinstance(colormap, list):
            result[slug]['colormapStops'] = colormap
        # Optional Python-side defaults for the overlay's initial UI state.
        # Omitted when unset so the frontend keeps its own fallbacks.
        if odata.get('opacity') is not None:
            result[slug]['opacity'] = float(odata['opacity'])
        if odata.get('stretch_low') is not None:
            result[slug]['stretchLow'] = float(odata['stretch_low'])
        if odata.get('stretch_high') is not None:
            result[slug]['stretchHigh'] = float(odata['stretch_high'])
        # Optional time annotation: how far the field is shifted relative to the
        # displayed frame, plus a free-text label. Omitted when unset so the
        # frontend shows nothing.
        if odata.get('offset_hours') is not None:
            result[slug]['timeOffsetHours'] = int(odata['offset_hours'])
        if odata.get('time_label'):
            result[slug]['timeLabel'] = str(odata['time_label'])
    return result


def build_json(
    methods_data: dict[str, dict],
    *,
    target_color: str = DEFAULT_TARGET_COLOR,
    title: str = DEFAULT_APP_TITLE,
    subtitle: str | None = DEFAULT_APP_SUBTITLE,
    overlays_data: dict[str, dict] | None = None,
    contours: bool | None = None,
    absolute: bool | None = None,
    viewer_options: dict[str, Any] | None = None,
) -> dict:
    """Build the v4 viewer JSON from pre-processed per-method level arrays.

    Parameters
    ----------
    methods_data:
        Either the legacy flat structure
        ``{slug: {'label': str, 'timestamp': str|None, 'target': Any|None, 'levels': {...}}}``
        or the multi-frame structure
        ``{slug: {'label': str, 'frames': {frame_key: {'timestamp': ..., 'target': ..., 'levels': {...}}}}}``.
        Arrays must already be preprocessed (native resolution retained) and optionally smoothed.
    target_color:
        CSS color string used for the target overlay in the frontend.
    title:
        Application title shown in the viewer header.
    subtitle:
        Optional application subtitle shown under the title. Pass ``None`` or
        an empty string to hide it.
    overlays_data:
        Optional dict of weather-field overlays.  Each entry has the form::

            {slug: {
                'label': str,
                'unit': str,
                'colormap': str,
                'offset_hours': int|None,   # optional time shift vs. frame
                'time_label': str|None,     # optional free-text annotation
                'frames': [{'arr': np.ndarray, 'timestamp': str|None}, ...],
            }}

        Arrays must be 2-D float32, already longitude-rolled.
    contours:
        Optional default depiction style for the viewer.  ``True`` starts the
        viewer with contour isolines instead of the filled heatmap; ``None``
        (default) omits the field and leaves the choice to the frontend.
    absolute:
        Optional default for the "Signed values" toggle.  ``True`` starts the
        viewer showing absolute magnitude (folding diverging data); ``None``
        (default) omits the field and leaves signed values on.
    viewer_options:
        Optional initial frontend options such as ``{"viewMode": "globe"}``.

    Returns a JSON-serialisable dict.
    """
    result_methods: dict[str, dict] = {}
    global_diverging = False
    hasher = hashlib.md5()
    normalized_target_color = _normalize_target_color(target_color)
    normalized_title = _normalize_app_title(title)
    normalized_subtitle = _normalize_app_subtitle(subtitle)
    hasher.update(b'targetColor')
    hasher.update(normalized_target_color.encode('utf-8'))
    hasher.update(b'appTitle')
    hasher.update(normalized_title.encode('utf-8'))
    hasher.update(b'appSubtitle')
    hasher.update(normalized_subtitle.encode('utf-8'))

    for slug in sorted(methods_data):
        mdata = methods_data[slug]
        frames_payload: list[dict[str, Any]] = []
        hasher.update(slug.encode('utf-8'))
        hasher.update(mdata['label'].encode('utf-8'))

        method_frames = [
            (frame_key, frame, frame.get('levels', {}))
            for frame_key, frame in _iter_method_frames(mdata)
            if frame.get('levels', {})
        ]
        if not method_frames:
            continue

        norm = mdata.get('norm', 'global')
        layer_labels = mdata.get('layer_labels', {})
        color_scheme = normalize_attribution_colormap(mdata.get('color_scheme'))
        hasher.update(b'colorScheme')
        hasher.update(json.dumps(color_scheme, sort_keys=True, separators=(',', ':')).encode('utf-8'))

        method_arrays = [
            arr.ravel()
            for _, _, levels in method_frames
            for arr in levels.values()
        ]
        method_stacked = np.concatenate(method_arrays)
        method_finite = _finite_values(method_stacked, context=f'attribution method {mdata.get("label", "")!r}')
        method_max_abs = (float(np.abs(method_finite).max()) if method_finite.size else 0.0) or 1.0
        method_diverging = bool(method_finite.size and method_finite.min() < -0.01 * method_max_abs)
        global_diverging = global_diverging or method_diverging

        for frame_key, frame, levels in method_frames:
            hasher.update(frame_key.encode('utf-8'))
            timestamp = frame.get('timestamp')
            if timestamp:
                hasher.update(timestamp.encode('utf-8'))

            serialized_target = _serialize_target(frame.get('target'))
            if serialized_target is not None:
                hasher.update(b'target')
                hasher.update(json.dumps(serialized_target, sort_keys=True, separators=(',', ':')).encode('utf-8'))

            sorted_levels = sorted(levels.items(), key=lambda kv: level_order(kv[0]))
            for level_id, arr in sorted_levels:
                hasher.update(level_id.encode('utf-8'))
                label = layer_labels.get(level_id) or default_layer_label(level_id)
                hasher.update(label.encode('utf-8'))
                hasher.update(arr.tobytes())

            if norm == 'per-frame':
                frame_arrays = np.concatenate([arr.ravel() for arr in levels.values()])
                frame_max_abs = _finite_max_abs(frame_arrays)
            else:
                frame_max_abs = method_max_abs

            frame_payload = {
                'timestamp': timestamp,
                'diverging': method_diverging,
                'levels': {
                    lid: _encode_level(
                        arr,
                        _finite_max_abs(arr) if norm == 'per-level' else frame_max_abs,
                        method_diverging,
                        lid,
                        layer_labels,
                    )
                    for lid, arr in sorted_levels
                },
            }
            if serialized_target is not None:
                frame_payload['target'] = serialized_target
            frames_payload.append(frame_payload)

        if not frames_payload:
            continue

        result_methods[slug] = {
            'label': mdata['label'],
            'shortLabel': short_label(mdata['label']),
            'diverging': method_diverging,
            'colorScheme': color_scheme,
            'frames': frames_payload,
        }

    normalized_viewer_options = dict(viewer_options or {})
    if contours is not None:
        hasher.update(b'contours:1' if contours else b'contours:0')
    if absolute is not None:
        hasher.update(b'absolute:1' if absolute else b'absolute:0')
    if normalized_viewer_options:
        hasher.update(b'viewerOptions')
        hasher.update(
            json.dumps(
                normalized_viewer_options,
                sort_keys=True,
                separators=(',', ':'),
            ).encode('utf-8')
        )

    result: dict[str, Any] = {
        'version': 4,
        'diverging': global_diverging,
        'appTitle': normalized_title,
        'appSubtitle': normalized_subtitle,
        'targetColor': normalized_target_color,
        'contentHash': hasher.hexdigest()[:12],
        'methods': result_methods,
    }
    if contours is not None:
        result['contours'] = bool(contours)
    if absolute is not None:
        result['absolute'] = bool(absolute)
    if normalized_viewer_options:
        result['viewerOptions'] = normalized_viewer_options

    if overlays_data:
        overlays_section = _build_overlays_section(overlays_data)
        if overlays_section:
            hasher.update(b'overlays')
            hasher.update(json.dumps(overlays_section, sort_keys=True, separators=(',', ':')).encode('utf-8'))
            result['contentHash'] = hasher.hexdigest()[:12]
            result['overlays'] = overlays_section

    return result


def export(
    methods_data: dict[str, dict],
    out_path: str,
    *,
    target_color: str = DEFAULT_TARGET_COLOR,
    title: str = DEFAULT_APP_TITLE,
    subtitle: str | None = DEFAULT_APP_SUBTITLE,
    overlays_data: dict[str, dict] | None = None,
    contours: bool | None = None,
    absolute: bool | None = None,
    viewer_options: dict[str, Any] | None = None,
) -> None:
    """Write viewer_data.json to *out_path*. Creates parent directories as needed."""
    data = build_json(
        methods_data,
        target_color=target_color,
        title=title,
        subtitle=subtitle,
        overlays_data=overlays_data,
        contours=contours,
        absolute=absolute,
        viewer_options=viewer_options,
    )
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
