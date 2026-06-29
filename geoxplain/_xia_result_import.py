"""Shared XiaResult expansion logic for viewer frontends."""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

from .exporter import is_valid_level_id


@dataclass(frozen=True)
class XiaResultImport:
    label: str
    timestamp: Optional[str]
    target: Any
    grids: dict[str, np.ndarray]
    layer_labels: dict[str, str] = field(default_factory=dict)


def iter_xia_result_imports(
    result: Any,
    *,
    consumer_name: str,
) -> list[XiaResultImport]:
    """Convert a duck-typed XiaResult bundle into per-(frame, variable) imports.

    Each frame of the bundle becomes one timeline entry per input variable, so
    a multi-frame bundle naturally fans out across the viewer's timeline (the
    method label stays constant; the timestamp distinguishes the frames).
    """
    method_base: str = getattr(result, 'method', 'Imported')
    # Prefer the human-readable display name when the bundle carries one; older
    # bundles (no method_label) fall back to the raw method id.
    method_display: str = (getattr(result, 'method_label', '') or '').strip() or method_base
    layer_labels: dict[str, str] = dict(getattr(result, 'layer_labels', {}) or {})
    frames: list = list(getattr(result, 'frames', []) or [])

    imports: list[XiaResultImport] = []
    dropped_levels: set[str] = set()
    for frame in frames:
        target_dict: Any = None
        if hasattr(frame, 'as_widget_dict'):
            try:
                target_dict = frame.as_widget_dict() or None
            except Exception:
                pass

        timestamp: Optional[str] = getattr(frame, 'timestamp', None) or None
        attributions: dict = getattr(frame, 'attributions', {})

        for wrt_var, level_grids in attributions.items():
            if not level_grids:
                continue
            filtered = {
                lvl: arr for lvl, arr in level_grids.items()
                if is_valid_level_id(lvl)
            }
            dropped_levels.update(
                lvl for lvl in level_grids if not is_valid_level_id(lvl)
            )
            if not filtered:
                continue
            imports.append(
                XiaResultImport(
                    label=f"{method_display} ({wrt_var})",
                    timestamp=timestamp,
                    target=target_dict,
                    grids=filtered,
                    layer_labels=layer_labels,
                )
            )

    if dropped_levels:
        warnings.warn(
            f"{consumer_name}: dropped {len(dropped_levels)} layer(s) with "
            f"unrecognised keys: {sorted(dropped_levels)}.  "
            f"Expected 'sfc' or 'z-<int>'.",
            stacklevel=3,
        )

    return imports
