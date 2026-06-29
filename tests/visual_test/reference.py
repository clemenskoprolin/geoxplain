"""Matplotlib reference renderer for the visual-comparison suite.

Produces the "ground-truth" panel the live viewer is supposed to match.

Design contract (read this before judging the side-by-sides):

* **Colour is independent.**  The reference uses the *real* matplotlib
  colormaps (``RdBu_r`` for diverging fields, ``Reds`` for sequential fields),
  exactly like the cartopy example in ``example_input/``.  The viewer ships a
  hand-tuned GLSL approximation of these ramps, so colour fidelity is honestly
  tested by the comparison.

* **Alpha follows the viewer spec.**  Transparency is a viewer design choice,
  not a matplotlib standard, so the reference applies the *same* opacity
  transfer the GLSL shader uses (see ``viewer/src/shaders/shared.ts``,
  ``densityToColor``) over a neutral background.  This makes the two images
  directly comparable and lets the opacity probe actually mean something.

* **Normalisation matches the exporter.**  density = (v/maxabs)*0.5+0.5 for
  diverging, v/maxabs for sequential — identical to
  ``geoxplain/exporter.py::_encode_level``.

Known, expected differences (not bugs):
  - background: neutral grey here vs. MapLibre topo tiles in the viewer.
  - projection: linear lon/lat (PlateCarree) here vs. Web-Mercator in the viewer
    (minor over the Europe window).
  - the viewer applies a perceptual ``pow(density, 0.65)`` to the *colour* lookup
    of the sequential ramp (brightens mid-tones); the reference does not.
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import colormaps
from matplotlib.cm import ScalarMappable
from scipy.ndimage import gaussian_filter

from .synthetic import EUROPE_EXTENT, europe_window

# Neutral background the transparent field is composited over (light slate),
# chosen to sit between the viewer's topo land/water tones.
BG_RGB = np.array([0.91, 0.93, 0.95], dtype=np.float32)


def _smoothstep(e0: float, e1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _alpha_diverging(density: np.ndarray) -> np.ndarray:
    """Mirror of GLSL importedFlatDivergingAlphaMode."""
    dist = np.abs(density - 0.5) * 2.0
    alpha = _smoothstep(0.025, 0.18, dist)
    alpha[dist <= 0.025] = 0.0
    return alpha


def _alpha_sequential(density: np.ndarray) -> np.ndarray:
    """Mirror of GLSL importedFlatSequentialAlphaMode."""
    alpha = _smoothstep(0.015, 0.18, density)
    alpha[density < 0.015] = 0.0
    return alpha


def _density(field_v: np.ndarray, diverging: bool, max_abs: float) -> np.ndarray:
    if max_abs <= 0:
        max_abs = 1.0
    if diverging:
        return (field_v / max_abs) * 0.5 + 0.5
    return field_v / max_abs


def render_reference(
    field_v: np.ndarray,
    *,
    diverging: bool,
    out_path: str,
    title: str,
    smooth_sigma: float | None = None,
) -> None:
    """Render one reference panel for the Europe window to ``out_path``.

    ``smooth_sigma`` (grid cells) applies the same separable Gaussian the viewer
    applies when "smooth imported grids" is on, so the smoothed reference and the
    smoothed viewer screenshot stay comparable.
    """
    rows, cols = europe_window()
    win = field_v[rows, cols].astype(np.float32)

    # max-abs over the *whole* field, matching the per-method exporter norm.
    max_abs = float(np.abs(field_v).max()) or 1.0

    if smooth_sigma:
        win = gaussian_filter(win, sigma=smooth_sigma, mode="nearest")

    density = np.clip(_density(win, diverging, max_abs), 0.0, 1.0)

    if diverging:
        rgb = colormaps["RdBu_r"](density)[..., :3]
        alpha = _alpha_diverging(density)
        cbar_label = "attribution (signed, RdBu_r)"
        vmin, vmax = -max_abs, max_abs
        cmap_name = "RdBu_r"
    else:
        rgb = colormaps["Reds"](density)[..., :3]
        alpha = _alpha_sequential(density)
        cbar_label = "attribution (magnitude, Reds)"
        vmin, vmax = 0.0, max_abs
        cmap_name = "Reds"

    # Composite RGBA field over the neutral background.
    a = alpha[..., None]
    composited = rgb * a + BG_RGB[None, None, :] * (1.0 - a)

    lon_min, lon_max, lat_min, lat_max = EUROPE_EXTENT
    fig, ax = plt.subplots(figsize=(6.4, 4.6), dpi=150)
    fig.patch.set_facecolor("white")
    ax.set_facecolor(tuple(BG_RGB))
    ax.imshow(
        composited,
        extent=[lon_min, lon_max, lat_min, lat_max],
        origin="upper",
        aspect="auto",
        interpolation="nearest",
    )
    ax.set_xlabel("longitude (°E)", fontsize=8)
    ax.set_ylabel("latitude (°N)", fontsize=8)
    ax.tick_params(labelsize=7)
    ax.grid(True, color="gray", alpha=0.35, linewidth=0.4, linestyle="--")
    ax.set_title(title, fontsize=9, fontweight="bold", loc="left")

    sm = ScalarMappable(
        cmap=cmap_name, norm=plt.Normalize(vmin=vmin, vmax=vmax)
    )
    cbar = fig.colorbar(sm, ax=ax, shrink=0.85, pad=0.02)
    cbar.set_label(cbar_label, fontsize=7)
    cbar.ax.tick_params(labelsize=6)

    fig.tight_layout()
    fig.savefig(out_path, dpi=150, facecolor="white")
    plt.close(fig)
