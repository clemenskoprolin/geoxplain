"""OverlayResult protocol and .overlay.npz file loader for geoxplain.

This module is the *only* contract between the visualization package and overlay
compute code.  There is **no import of ``geoxplain_aurora_adapter``** here.
The contract is duck-typed: any object that satisfies ``OverlayResultProtocol``
can be passed to ``GeoXplain.add_overlay()`` or ``GeoXplainWidget.add_overlay()``.

File format (``.overlay.npz``, ``format_version == 3``)
-------------------------------------------------------
A ``.overlay.npz`` bundle holds one weather-field variable and one or more
frames (time steps).  The zip archive contains:

- ``meta.json`` — JSON with ``variable``, ``level``, ``label``, ``unit``,
  ``colormap``, ``visible``, ``overlay_offset_hours`` (added in version 2;
  default 0), ``time_label`` (added in version 3; optional free-text annotation
  shown by the viewer next to the offset, default ``None``), optional ``meta``,
  and a ``frames`` list.  Each frame has ``timestamp`` and a ``member``
  filename (``f0.npy``, …).
- ``f{i}.npy`` — float32 2-D arrays, one per frame.
- ``lat.npy`` / ``lon.npy`` — optional coordinate vectors (ignored by this
  loader; the widget uses its default global grid).

Usage::

    from geoxplain import GeoXplainWidget
    from geoxplain.overlay_result import load_overlay_result

    overlay = load_overlay_result("humidity.overlay.npz")
    w = GeoXplainWidget()
    w.add_overlay(overlay)
"""

from __future__ import annotations

import io
import json
import os
import warnings
import zipfile
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

import numpy as np

#: Archive layout this loader was written against (stored in ``meta.json``).
_FORMAT_VERSION = 3


def _warn_on_format_version(meta_payload: dict, *, expected: int, path: str) -> None:
    """Warn (but do not fail) when the archive's ``format_version`` is newer.

    Older bundles predate the field or use a lower version; those are
    forward-compatible and load silently (missing fields fall back to defaults).
    Only a *newer*-than-expected version is surfaced, since it may carry a layout
    this loader does not understand.
    """
    version = meta_payload.get("format_version")
    if version is not None and version > expected:
        warnings.warn(
            f"{path}: format_version {version!r} is newer than the expected "
            f"{expected!r}; attempting to load anyway, but results may be wrong.",
            stacklevel=3,
        )


# ── Per-frame protocol + concrete loader ──────────────────────────────────────

@runtime_checkable
class OverlayFrameProtocol(Protocol):
    timestamp: str
    data: np.ndarray


@dataclass
class OverlayFrameFile:
    """Concrete ``OverlayFrameProtocol`` implementation loaded from a ``.overlay.npz``."""

    timestamp: str
    data: np.ndarray


# ── Bundle protocol + concrete loader ─────────────────────────────────────────

@runtime_checkable
class OverlayResultProtocol(Protocol):
    variable: str
    level: int | None
    frames: list
    label: str
    unit: str
    colormap: Any
    visible: bool


@dataclass
class OverlayResultFile:
    """Concrete ``OverlayResultProtocol`` implementation loaded from a ``.overlay.npz``."""

    variable: str
    level: int | None
    frames: list[OverlayFrameFile]
    label: str
    unit: str
    colormap: Any
    visible: bool
    overlay_offset_hours: int = 0
    time_label: str | None = None
    meta: dict = field(default_factory=dict)

    def __repr__(self) -> str:
        level = "surface" if self.level is None else f"{self.level} hPa"
        return (
            f"OverlayResultFile(variable={self.variable!r}, level={level}, "
            f"n_frames={len(self.frames)})"
        )


@dataclass
class ImportedOverlay:
    arrays: np.ndarray
    timestamps: list[str]
    name: str
    unit: str
    colormap: Any
    visible: bool
    overlay_offset_hours: int = 0
    time_label: str | None = None


def _frame_data(frame: Any) -> np.ndarray:
    if hasattr(frame, "data"):
        return np.asarray(frame.data, dtype=np.float32)
    if isinstance(frame, dict) and "data" in frame:
        return np.asarray(frame["data"], dtype=np.float32)
    raise TypeError("Overlay frames must expose a `data` array.")


def _frame_timestamp(frame: Any) -> str:
    if hasattr(frame, "timestamp"):
        return str(frame.timestamp)
    if isinstance(frame, dict):
        return str(frame.get("timestamp", ""))
    return ""


def overlay_result_to_import(overlay: Any) -> ImportedOverlay:
    """Convert a duck-typed OverlayResult into widget/import_overlay inputs."""

    frames = list(getattr(overlay, "frames", []))
    if not frames:
        raise ValueError("Overlay result has no frames.")

    arrays = np.stack([_frame_data(frame) for frame in frames])
    timestamps = [_frame_timestamp(frame) for frame in frames]
    variable = str(getattr(overlay, "variable", "overlay"))
    level = getattr(overlay, "level", None)
    default_name = variable if level is None else f"{variable} {level} hPa"
    return ImportedOverlay(
        arrays=arrays,
        timestamps=timestamps,
        name=str(getattr(overlay, "label", "") or default_name),
        unit=str(getattr(overlay, "unit", "") or ""),
        colormap=getattr(overlay, "colormap", "viridis") or "viridis",
        visible=bool(getattr(overlay, "visible", True)),
        overlay_offset_hours=int(getattr(overlay, "overlay_offset_hours", 0) or 0),
        time_label=getattr(overlay, "time_label", None),
    )


def load_overlay_result(path: str | os.PathLike) -> OverlayResultFile:
    """Load a ``.overlay.npz`` file produced by ``OverlayResult.save()``.

    Parameters
    ----------
    path:
        Path to the ``.overlay.npz`` archive (``format_version == 3``; older
        version-1/2 bundles load too, with ``overlay_offset_hours`` defaulting
        to 0 and ``time_label`` to ``None``).

    Returns
    -------
    An ``OverlayResultFile`` instance that satisfies ``OverlayResultProtocol``
    and can be passed to ``GeoXplainWidget.add_overlay()``.
    """
    path = os.fspath(path)
    with zipfile.ZipFile(path, "r") as zf:
        meta_payload: dict = json.loads(zf.read("meta.json"))
        _warn_on_format_version(meta_payload, expected=_FORMAT_VERSION, path=path)
        frames: list[OverlayFrameFile] = []
        for frame_meta in meta_payload.get("frames", []):
            member = frame_meta["member"]
            buf = io.BytesIO(zf.read(member))
            frames.append(
                OverlayFrameFile(
                    timestamp=frame_meta.get("timestamp", ""),
                    data=np.load(buf),
                )
            )

    return OverlayResultFile(
        variable=meta_payload["variable"],
        level=meta_payload.get("level"),
        frames=frames,
        label=meta_payload.get("label", meta_payload["variable"]),
        unit=meta_payload.get("unit", ""),
        colormap=meta_payload.get("colormap", "viridis"),
        visible=meta_payload.get("visible", True),
        overlay_offset_hours=int(meta_payload.get("overlay_offset_hours", 0)),
        time_label=meta_payload.get("time_label"),
        meta=meta_payload.get("meta", {}),
    )
