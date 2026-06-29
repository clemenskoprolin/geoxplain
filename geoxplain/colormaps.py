"""Colormap specification parsing and validation for viewer JSON export.

Two colormap families are handled here:

- **Attribution** colormaps (:func:`normalize_attribution_colormap`) — preset
  names from :data:`ATTRIBUTION_COLORMAPS` or 2-8 custom ``(position, color)``
  stops, emitted as a ``{'type': 'preset'|'custom', ...}`` dict.
- **Overlay** colormaps (:func:`normalize_overlay_colormap`) — preset names from
  :data:`VALID_COLORMAPS` or custom gradient stops, emitted as a preset string
  or a ``[[position, color], ...]`` list.

Both reuse :func:`_normalize_hex_color` for strict ``#RGB`` / ``#RRGGBB`` parsing.
"""

import re
from typing import Any

ATTRIBUTION_COLORMAPS = (
    'default',
    'rdbu',
    'coolwarm',
    'purple-green',
    'reds',
    'viridis',
    'plasma',
    'magma',
    'inferno',
    'cividis',
)
_HEX_COLOR_RE = re.compile(r'^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')

VALID_COLORMAPS = ('viridis', 'plasma', 'thermal', 'sequential')


def _normalize_hex_color(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError(f'custom colormap colors must be hex strings. Got: {value!r}')
    stripped = value.strip()
    match = _HEX_COLOR_RE.match(stripped)
    if not match:
        raise ValueError(
            'custom colormap colors must be opaque #RGB or #RRGGBB hex strings. '
            f'Got: {value!r}'
        )
    hex_part = match.group(1).lower()
    if len(hex_part) == 3:
        hex_part = ''.join(ch * 2 for ch in hex_part)
    return f'#{hex_part}'


def normalize_attribution_colormap(colormap: Any = None) -> dict[str, Any]:
    """Validate and normalize an attribution colormap spec for JSON export."""
    if colormap is None:
        return {'type': 'preset', 'name': 'default'}

    if isinstance(colormap, dict):
        kind = colormap.get('type')
        if kind == 'preset':
            return normalize_attribution_colormap(colormap.get('name'))
        if kind == 'custom':
            raw_stops = colormap.get('stops')
            if not isinstance(raw_stops, list):
                raise ValueError('custom colormap colorScheme must contain a stops list.')
            return normalize_attribution_colormap([
                (stop.get('position'), stop.get('color'))
                for stop in raw_stops
                if isinstance(stop, dict)
            ])
        raise ValueError(f'unknown colormap colorScheme type: {kind!r}')

    if isinstance(colormap, str):
        name = colormap.strip().lower().replace('_', '-')
        if not name:
            raise ValueError('colormap must not be empty.')
        if name not in ATTRIBUTION_COLORMAPS:
            raise ValueError(
                f'colormap must be one of {ATTRIBUTION_COLORMAPS} or 2-8 custom stops. '
                f'Got: {colormap!r}'
            )
        return {'type': 'preset', 'name': name}

    if not hasattr(colormap, '__len__'):
        raise ValueError(
            f'colormap must be a preset string or a sequence of custom stops. Got: {colormap!r}'
        )

    stops_input = list(colormap)
    if not 2 <= len(stops_input) <= 8:
        raise ValueError(f'custom colormap must contain 2-8 stops. Got {len(stops_input)}.')

    positioned = not all(isinstance(stop, str) for stop in stops_input)
    stops: list[dict[str, Any]] = []
    previous_position: float | None = None

    for index, stop in enumerate(stops_input):
        if positioned:
            if isinstance(stop, str) or not hasattr(stop, '__len__') or len(stop) != 2:
                raise ValueError(
                    'positioned custom colormap stops must be (position, color) pairs. '
                    f'Got: {stop!r}'
                )
            position = float(stop[0])
            color = _normalize_hex_color(stop[1])
        else:
            position = index / (len(stops_input) - 1)
            color = _normalize_hex_color(stop)

        if not 0.0 <= position <= 1.0:
            raise ValueError(f'custom colormap stop positions must be in [0, 1]. Got: {position!r}')
        if previous_position is not None and position <= previous_position:
            raise ValueError('custom colormap stop positions must be strictly increasing.')
        previous_position = position
        stops.append({'position': position, 'color': color})

    return {'type': 'custom', 'stops': stops}


def normalize_overlay_colormap(colormap: Any = 'viridis') -> str | list[list[Any]]:
    """Validate and normalize a weather-overlay colormap spec."""
    if colormap is None:
        return 'viridis'

    if isinstance(colormap, str):
        name = colormap.strip().lower().replace('_', '-')
        if name not in VALID_COLORMAPS:
            raise ValueError(
                f'overlay colormap must be one of {VALID_COLORMAPS} or custom gradient stops. '
                f'Got: {colormap!r}'
            )
        return name

    if isinstance(colormap, dict):
        if colormap.get('type') == 'custom':
            raw_stops = colormap.get('stops', colormap.get('colormapStops'))
            if not isinstance(raw_stops, list):
                raise ValueError('custom overlay colormap dictionaries must contain a stops list.')
            colormap = [
                (stop.get('position'), stop.get('color'))
                for stop in raw_stops
                if isinstance(stop, dict)
            ]
        else:
            raise ValueError(f'unknown overlay colormap type: {colormap.get("type")!r}')

    if isinstance(colormap, str) or not hasattr(colormap, '__len__'):
        raise ValueError(
            f'overlay colormap must be a preset string or custom gradient stops. Got: {colormap!r}'
        )

    stops_input = list(colormap)
    if len(stops_input) < 2:
        raise ValueError(f'custom overlay colormap must contain at least 2 stops. Got {len(stops_input)}.')

    stops: list[list[Any]] = []
    previous_position: float | None = None
    for stop in stops_input:
        if isinstance(stop, str) or not hasattr(stop, '__len__') or len(stop) != 2:
            raise ValueError(
                'custom overlay colormap stops must be (position, color) pairs. '
                f'Got: {stop!r}'
            )
        position = float(stop[0])
        color = _normalize_hex_color(stop[1])
        if not 0.0 <= position <= 1.0:
            raise ValueError(f'custom overlay colormap stop positions must be in [0, 1]. Got: {position!r}')
        if previous_position is not None and position <= previous_position:
            raise ValueError('custom overlay colormap stop positions must be strictly increasing.')
        previous_position = position
        stops.append([position, color])

    if stops[0][0] != 0.0 or stops[-1][0] != 1.0:
        raise ValueError('custom overlay colormap stops must start at 0.0 and end at 1.0.')

    return stops
