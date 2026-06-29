"""XiaResult protocol and .xia.npz file loader for geoxplain.

This module defines the model-agnostic contract between the visualization
package and computation backends. There is no backend import here. The
contract is duck-typed: any object that satisfies ``XiaResultProtocol`` can be
passed to ``GeoXplain.add_attribution()`` or
``GeoXplainWidget.add_attribution()``.

File format (``.xia.npz``, ``format_version == 2``)
---------------------------------------------------
A ``.xia.npz`` bundle holds **one method and one or more frames** (time steps).
The zip archive contains:

- ``meta.json``  — JSON with ``method``, ``meta``, optional ``layer_labels``,
                   and a ``frames`` list.  Each frame has ``timestamp``,
                   ``target``, ``diverging``, optional ``meta``, and an
                   ``attributions_index`` (wrt_var → list of level keys).
- ``f{i}__{wrt_var}__{level_key}.npy`` — two-dimensional float32 maps for
  frame ``i``.  Atmospheric level keys are ``"z-{N}"`` (higher ``N`` renders
  higher); surface variables use ``"sfc"``.

The separators ``"__"`` (between the three name parts) and ``"-"`` (inside a
level key) never collide, so a member name splits unambiguously.

Usage::

    from geoxplain import GeoXplain
    from geoxplain.xia_result import load_xia_result

    result = load_xia_result("ticino_q850_saliency.xia.npz")
    exporter = GeoXplain()
    exporter.add_attribution(result)   # every frame lands on the timeline
"""

from __future__ import annotations

import io
import json
import os
import warnings
import zipfile
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

import numpy as np


#: Archive layout this loader was written against (stored in ``meta.json``).
_FORMAT_VERSION = 2


def _warn_on_format_version(meta_payload: dict, *, expected: int, path: str) -> None:
    """Warn (but do not fail) when the archive's ``format_version`` is unexpected.

    Older bundles predate the field and omit it; those are loaded silently. A
    present-but-mismatched version is surfaced so a layout change is visible
    instead of producing confusing downstream errors.
    """
    version = meta_payload.get("format_version")
    if version is not None and version != expected:
        warnings.warn(
            f"{path}: format_version {version!r} does not match the expected "
            f"{expected!r}; attempting to load anyway, but results may be wrong.",
            stacklevel=3,
        )


# ── Per-frame protocol + concrete loader ──────────────────────────────────────

@runtime_checkable
class XiaFrameProtocol(Protocol):
    """Duck-typed interface for one time step of a :class:`XiaResultProtocol`."""

    timestamp: str
    """ISO-8601 string of the input frame's t1 timestep."""

    attributions: dict  # dict[str, dict[str, np.ndarray]]
    """``attributions[wrt_var][level_key]`` → two-dimensional float32 array.
    Level keys: ``"z-{N}"`` for atmospheric, ``"sfc"`` for surface."""

    diverging: bool
    """Whether attributions contain significant negative values."""

    def as_widget_dict(self) -> dict:
        """Return this frame's target info as a dict accepted by the widget."""
        ...


@dataclass
class XiaFrameFile:
    """Concrete ``XiaFrameProtocol`` implementation loaded from a ``.xia.npz``."""

    timestamp: str
    attributions: dict[str, dict[str, np.ndarray]]
    diverging: bool
    meta: dict = field(default_factory=dict)
    _target_dict: dict = field(default_factory=dict, repr=False)

    def as_widget_dict(self) -> dict:
        """Return the frame's target info in the format accepted by the widget.

        ``mode="box"`` targets store ``(lat, lon)`` as the box *center* and
        ``size=(dlat, dlon)`` as the full extent in degrees; we derive
        south / north / west / east from those here.
        """
        t = self._target_dict
        mode = t.get("mode", "")
        lat = t.get("lat")
        lon = t.get("lon")
        if mode == "point" and lat is not None and lon is not None:
            return {"type": "point", "lat": float(lat), "lon": float(lon)}
        if mode == "box" and lat is not None and lon is not None:
            size = t.get("size")
            dlat, dlon = (size if size else (2.0, 3.0))
            return {
                "type": "box",
                "south": float(lat) - float(dlat) / 2.0,
                "north": float(lat) + float(dlat) / 2.0,
                "west":  float(lon) - float(dlon) / 2.0,
                "east":  float(lon) + float(dlon) / 2.0,
            }
        return {}


# ── Bundle protocol + concrete loader ─────────────────────────────────────────

@runtime_checkable
class XiaResultProtocol(Protocol):
    """Duck-typed interface accepted by ``add_attribution()``.

    Any object providing these attributes can be used, regardless of which
    model or explanation library produced it.
    """

    method: str
    """Explanation method identifier (machine id or label).

    An optional ``method_label`` attribute (human-readable display name) is
    honored when present — read defensively via ``getattr`` by consumers, so it
    is intentionally *not* a required protocol member.
    """

    frames: list
    """One :class:`XiaFrameProtocol` per time step."""

    layer_labels: dict
    """``{level_key: display_name}`` shared across frames (may be empty)."""

    meta: dict
    """Bundle-level diagnostic metadata."""


@dataclass
class XiaResultFile:
    """Concrete ``XiaResultProtocol`` implementation loaded from a ``.xia.npz``."""

    method: str
    frames: list[XiaFrameFile]
    layer_labels: dict[str, str] = field(default_factory=dict)
    meta: dict = field(default_factory=dict)
    method_label: str = ""

    def __repr__(self) -> str:
        n_maps = sum(
            len(levels)
            for frame in self.frames
            for levels in frame.attributions.values()
        )
        return (
            f"XiaResultFile(method={self.method!r}, n_frames={len(self.frames)}, "
            f"n_maps={n_maps})"
        )


def load_xia_result(path: str | os.PathLike) -> XiaResultFile:
    """Load a backend-independent ``.xia.npz`` attribution bundle.

    Parameters
    ----------
    path:
        Path to the ``.xia.npz`` archive (``format_version == 2``).

    Returns
    -------
    An ``XiaResultFile`` instance that satisfies ``XiaResultProtocol``
    and can be passed to ``GeoXplain.add_attribution()`` or
    ``GeoXplainWidget.add_attribution()``.
    """
    path = os.fspath(path)
    with zipfile.ZipFile(path, "r") as zf:
        meta_payload: dict = json.loads(zf.read("meta.json"))
        _warn_on_format_version(meta_payload, expected=_FORMAT_VERSION, path=path)
        frames: list[XiaFrameFile] = []
        for i, frame_meta in enumerate(meta_payload.get("frames", [])):
            index: dict[str, list[str]] = frame_meta.get("attributions_index", {})
            attributions: dict[str, dict[str, np.ndarray]] = {}
            for wrt_var, level_keys in index.items():
                attributions[wrt_var] = {}
                for level_key in level_keys:
                    member = f"f{i}__{wrt_var}__{level_key}.npy"
                    buf = io.BytesIO(zf.read(member))
                    attributions[wrt_var][level_key] = np.load(buf)
            frames.append(
                XiaFrameFile(
                    timestamp=frame_meta.get("timestamp", ""),
                    attributions=attributions,
                    diverging=frame_meta.get("diverging", False),
                    meta=frame_meta.get("meta", {}),
                    _target_dict=frame_meta.get("target", {}),
                )
            )

    return XiaResultFile(
        method=meta_payload["method"],
        method_label=meta_payload.get("method_label", ""),
        frames=frames,
        layer_labels=meta_payload.get("layer_labels", {}),
        meta=meta_payload.get("meta", {}),
    )
