"""Target (point/box) serialization for the viewer JSON export.

:func:`_serialize_target` accepts the several Python target spellings the public
API allows and emits the viewer's canonical ``{'type': 'point'|'box', ...}``
dict, wrapping longitudes to the viewer's ``[-180, 180)`` convention.
"""

from typing import Any


def _normalize_longitude(value: Any) -> float:
    """Wrap longitudes to the viewer's [-180, 180) convention."""
    wrapped = (float(value) + 180.0) % 360.0 - 180.0
    return 0.0 if wrapped == -0.0 else wrapped


def _serialize_target(target: Any) -> dict | None:
    """Convert a Python target spec to a JSON-serialisable dict, or None.

    Accepted forms:
    - ``(lat, lon)``                                          → point
    - ``(lat_min, lon_min, lat_max, lon_max)``                → box
    - ``{'lat': float, 'lon': float}``                       → point
    - ``{'latMin': …, 'lonMin': …, 'latMax': …, 'lonMax': …}`` → box
    - ``{'south': …, 'north': …, 'west': …, 'east': …}``     → box
    """
    if target is None:
        return None
    if isinstance(target, dict):
        if 'lat' in target and 'lon' in target:
            return {
                'type': 'point',
                'lat': float(target['lat']),
                'lon': _normalize_longitude(target['lon']),
            }
        if all(k in target for k in ('latMin', 'lonMin', 'latMax', 'lonMax')):
            lat_min = min(float(target['latMin']), float(target['latMax']))
            lat_max = max(float(target['latMin']), float(target['latMax']))
            return {
                'type': 'box',
                'latMin': lat_min,
                'lonMin': _normalize_longitude(target['lonMin']),
                'latMax': lat_max,
                'lonMax': _normalize_longitude(target['lonMax']),
            }
        if all(k in target for k in ('south', 'north', 'west', 'east')):
            lat_min = min(float(target['south']), float(target['north']))
            lat_max = max(float(target['south']), float(target['north']))
            return {
                'type': 'box',
                'latMin': lat_min,
                'lonMin': _normalize_longitude(target['west']),
                'latMax': lat_max,
                'lonMax': _normalize_longitude(target['east']),
            }
    if hasattr(target, '__len__') and not isinstance(target, str):
        if len(target) == 2:
            return {
                'type': 'point',
                'lat': float(target[0]),
                'lon': _normalize_longitude(target[1]),
            }
        if len(target) == 4:
            lat_min = min(float(target[0]), float(target[2]))
            lat_max = max(float(target[0]), float(target[2]))
            return {
                'type': 'box',
                'latMin': lat_min,
                'lonMin': _normalize_longitude(target[1]),
                'latMax': lat_max,
                'lonMax': _normalize_longitude(target[3]),
            }
    raise ValueError(
        'target must be a (lat, lon) tuple, a (lat_min, lon_min, lat_max, lon_max) tuple, '
        "or a dict with 'lat'/'lon' keys (point) or 'latMin'/'lonMin'/'latMax'/'lonMax' keys (box). "
        f'Got: {target!r}'
    )
