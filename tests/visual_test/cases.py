"""Test-case catalogue + viewer launch-state builder.

Each :class:`Case` is exported into ``viewer_data.json`` as one GeoXplain
*method*.  A case may yield several :class:`Capture`s, which screenshot the
*same* method under different viewer state (e.g. smoothing off vs. on).  The
matplotlib reference for each capture is rendered with the matching
``ref_smooth_sigma`` so the two sides stay comparable.

The probe matrix:

    aspect      diverging field            sequential field
    --------    -----------------------    -----------------------
    colormap    signed ramp (-1..+1)       magnitude ramp (0..1)
    opacity     blobs, amps 0.05..1.0      blobs, amps 0.05..1.0
    smoothing   checkerboard + spikes      checkerboard + spikes
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from geoxplain.loader import slugify

from . import synthetic

# All captures use the same top-down 2-D map framing so the comparison against
# the (flat, top-down) matplotlib reference is apples-to-apples.
_EUROPE_MAP_CAMERA = {"lng": 16.5, "lat": 48.0, "zoom": 3.7, "pitch": 0.0}
_GLOBE_CAMERA = {"lat": 48.0, "lng": 16.5, "altitude": 2.5}  # unused in map mode

# Only the 700 hPa layer (z-3) carries data; keep every other level hidden so
# the flat-mode fuse (max over visible levels) shows exactly our field.
_LEVEL_IDS = ["z-0", "z-2", "z-3", "z-5", "z-7", "z-9"]
DATA_LEVEL_HPA = 700
DATA_LEVEL_ID = "z-3"

SMOOTH_SIGMA = 2.0  # grid cells, used for both the viewer and the reference


@dataclass(frozen=True)
class Capture:
    suffix: str               # filename suffix, e.g. "smooth-on"
    caption: str              # one-line description of this capture's purpose
    smooth_imported: bool = False
    ref_smooth_sigma: float | None = None


@dataclass(frozen=True)
class Case:
    # NOTE: ``label`` must NOT end in a "(...)" group — the viewer parses
    # "base (var)" labels into an input-variable selector that the launch-state
    # URL cannot drive, so every screenshot would collapse onto the first
    # method. Plain space-separated labels keep each case an independent method.
    label: str                # human method name shown in the viewer
    aspect: str               # "colormap" | "opacity" | "smoothing"
    diverging: bool
    field_fn: Callable[[bool], np.ndarray]
    evaluate: str             # what an evaluator should check
    captures: list[Capture] = field(default_factory=lambda: [Capture("main", "")])

    @property
    def slug(self) -> str:
        """GeoXplain method slug — must match ``slugify(label)`` from the exporter."""
        return slugify(self.label)

    def field_v(self) -> np.ndarray:
        """The field in viewer/geographic coordinates."""
        return self.field_fn(self.diverging)


def _kind(diverging: bool) -> str:
    return "diverging" if diverging else "sequential"


CASES: list[Case] = [
    Case(
        label="Colormap Ramp Diverging",
        aspect="colormap",
        diverging=True,
        field_fn=synthetic.ramp,
        evaluate=(
            "A west->east hue sweep must run deep blue (most negative) -> pale -> "
            "near-transparent white at the zero centre -> pale red -> deep red "
            "(most positive). Check the blue and red ends are balanced and the "
            "neutral band sits in the middle, matching matplotlib RdBu_r."
        ),
    ),
    Case(
        label="Colormap Ramp Sequential",
        aspect="colormap",
        diverging=False,
        field_fn=synthetic.ramp,
        evaluate=(
            "A west->east magnitude sweep must run transparent/near-white (zero) "
            "-> light warm -> saturated deep red (max), monotonically. No blue "
            "should appear. Compare hue progression against matplotlib Reds."
        ),
    ),
    Case(
        label="Opacity Blobs Diverging",
        aspect="opacity",
        diverging=True,
        field_fn=synthetic.blobs,
        evaluate=(
            "Six blobs of increasing magnitude (~0.05..1.0 of max), alternating "
            "sign. The faintest (left) blobs must be nearly invisible (below the "
            "dead-band) and the strongest fully opaque/saturated; opacity must "
            "rise monotonically with magnitude. Signs alternate blue/red."
        ),
    ),
    Case(
        label="Opacity Blobs Sequential",
        aspect="opacity",
        diverging=False,
        field_fn=synthetic.blobs,
        evaluate=(
            "Six positive blobs of increasing magnitude. Faintest must fade to "
            "transparent, strongest fully opaque red, opacity monotonically "
            "increasing with magnitude."
        ),
    ),
    Case(
        label="Alternating Slight Diverging",
        aspect="alternating-sign",
        diverging=True,
        field_fn=synthetic.alternating_slight,
        evaluate=(
            "Rapidly alternating blue/red stripes at only ~12% of the field max "
            "(slight ± values), with one saturated blue blob (top-left) and one "
            "saturated red blob (bottom-right) setting the scale. Verify: (1) the "
            "slight stripes stay pale/faint and mostly transparent near the white "
            "zero centre — they must NOT saturate to full blue/red; (2) the rapid "
            "sign flips alternate cleanly (or, if the viewer's ~0.7°/texel volume "
            "cannot resolve them, average toward transparent rather than smearing "
            "into one colour); (3) the two corner anchor blobs are fully opaque, "
            "deep blue and deep red. Compare hue/opacity against matplotlib RdBu_r."
        ),
    ),
    Case(
        label="Smoothing Checkerboard Diverging",
        aspect="smoothing",
        diverging=True,
        field_fn=synthetic.checkerboard,
        evaluate=(
            "Smooth OFF: crisp alternating blue/red squares with hard edges and "
            "pin-point spikes. Smooth ON: the same squares and spikes are visibly "
            "blurred/softened. Compare the OFF and ON viewer panels against the "
            "raw and Gaussian-blurred references respectively."
        ),
        captures=[
            Capture("smooth-off", "smoothing disabled (raw grid)",
                    smooth_imported=False, ref_smooth_sigma=None),
            Capture("smooth-on", f"smoothing enabled (sigma={SMOOTH_SIGMA} cells)",
                    smooth_imported=True, ref_smooth_sigma=SMOOTH_SIGMA),
        ],
    ),
    Case(
        label="Smoothing Checkerboard Sequential",
        aspect="smoothing",
        diverging=False,
        field_fn=synthetic.checkerboard,
        evaluate=(
            "Smooth OFF: crisp red/empty squares and pin-point spikes. Smooth ON: "
            "squares and spikes visibly blurred. Compare OFF/ON viewer panels "
            "against raw / Gaussian-blurred references."
        ),
        captures=[
            Capture("smooth-off", "smoothing disabled (raw grid)",
                    smooth_imported=False, ref_smooth_sigma=None),
            Capture("smooth-on", f"smoothing enabled (sigma={SMOOTH_SIGMA} cells)",
                    smooth_imported=True, ref_smooth_sigma=SMOOTH_SIGMA),
        ],
    ),
]


def kind_of(case: Case) -> str:
    return _kind(case.diverging)


def launch_state(slug: str, capture: Capture) -> dict:
    """Build a complete, schema-valid ``?state=`` payload for one capture.

    Every field required by ``viewer/src/lib/launchState.ts::parseLaunchState``
    is present, otherwise the parser rejects the whole object and the viewer
    silently falls back to defaults.
    """
    pressure_levels = [
        {"id": lid, "visible": lid == DATA_LEVEL_ID, "opacity": 1.0}
        for lid in _LEVEL_IDS
    ]
    return {
        "selectedMethod": slug,
        "timestampIndex": 0,
        "viewMode": "map",
        "mapType": "topo",
        "contours": False,
        "pressureLevels": pressure_levels,
        "smoothImportedGrids": capture.smooth_imported,
        "smoothImportedGridSigma": SMOOTH_SIGMA,
        "globeCamera": _GLOBE_CAMERA,
        "mapCamera": _EUROPE_MAP_CAMERA,
    }
