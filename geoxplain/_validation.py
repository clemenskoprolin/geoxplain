"""Free input-normalization helpers shared by :class:`GeoXplainBase`.

These are the stateless validators and small converters used by the public
``add_attribution`` / ``add_overlay`` / ``set_options`` surface. They hold no
viewer state, so they live apart from the :class:`GeoXplainBase` class itself.
"""

from __future__ import annotations

import os
from collections.abc import Sequence
from typing import Any, Optional

import numpy as np


def _frame_key(timestamp: Optional[str]) -> str:
    """Stable internal key for one imported frame."""
    return timestamp if timestamp is not None else '__default__'


def _as_preprocess_source(source: str | os.PathLike[str] | np.ndarray) -> str | np.ndarray:
    return os.fspath(source) if isinstance(source, os.PathLike) else source


def _normalize_method(method: Any) -> str:
    if not isinstance(method, str):
        raise ValueError(f'method must be a string. Got: {method!r}')
    normalized = method.strip()
    if not normalized:
        raise ValueError('method must not be empty.')
    return normalized


def _normalize_timestamps(timestamps: Sequence[str | None] | None) -> list[str | None] | None:
    if timestamps is None:
        return None
    if isinstance(timestamps, (str, bytes)):
        raise TypeError('timestamps must be a sequence of strings, not a single string.')
    return list(timestamps)


def _normalize_overlay_opacity(opacity: float | None) -> float | None:
    if opacity is None:
        return None
    try:
        value = float(opacity)
    except (TypeError, ValueError):
        raise ValueError(f'opacity must be a number in [0, 1]. Got: {opacity!r}')
    if not 0.0 <= value <= 1.0:
        raise ValueError(f'opacity must be in [0, 1]. Got: {value!r}')
    return value


def _normalize_overlay_stretch(
    stretch: tuple[float, float] | Sequence[float] | None,
) -> tuple[float, float] | None:
    if stretch is None:
        return None
    if isinstance(stretch, (str, bytes)) or not hasattr(stretch, '__len__'):
        raise ValueError(f'stretch must be a (low, high) pair. Got: {stretch!r}')
    values = list(stretch)
    if len(values) != 2:
        raise ValueError(f'stretch must be a (low, high) pair. Got: {stretch!r}')
    try:
        low, high = float(values[0]), float(values[1])
    except (TypeError, ValueError):
        raise ValueError(f'stretch values must be numbers in [0, 1]. Got: {stretch!r}')
    if not (0.0 <= low <= 1.0 and 0.0 <= high <= 1.0):
        raise ValueError(f'stretch values must be in [0, 1]. Got: {stretch!r}')
    if low >= high:
        raise ValueError(f'stretch low must be strictly less than high. Got: {stretch!r}')
    return (low, high)


def _snake_to_camel(name: str) -> str:
    parts = name.split('_')
    return parts[0] + ''.join(part[:1].upper() + part[1:] for part in parts[1:])
