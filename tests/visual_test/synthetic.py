"""Synthetic debug fields for the visual-comparison test suite.

All fields are generated in **viewer/geographic coordinates** ``V`` where

    column j  ->  lon = -180 + j * 0.25   (j in [0, 1440))
    row    i  ->  lat =   90 - i * 0.25   (i in [0,  721))

i.e. exactly what the viewer renders after ``preprocess_array`` has rolled the
longitude axis.  The matplotlib reference renderer consumes ``V`` directly.

Because ``GeoXplain.import_data`` calls ``preprocess_array`` which rolls the
longitude axis by ``ncols // 2``, the array handed to the viewer must be
*pre-rolled* so the roll inside the pipeline lands the content back at ``V``.
Use :func:`to_viewer_array` for that.

The fields are deliberately localised over a Europe window that matches the
extent used by the cartopy reference plot (``example_input/how_it_should_
look_code_for_reference.py``), so the live viewer and the matplotlib panel can
be framed on the same region.
"""

from __future__ import annotations

import numpy as np

# Native Aurora grid.
NLAT = 721
NLON = 1440
RES = 0.25  # degrees per cell

# Europe window (geographic, [-180,180) longitude) matching the reference plot.
# (lon_min, lon_max, lat_min, lat_max)
EUROPE_EXTENT = (-12.0, 45.0, 30.0, 66.0)


def viewer_lon() -> np.ndarray:
    """Longitude of every column in viewer coordinates, shape (NLON,)."""
    return -180.0 + np.arange(NLON) * RES


def viewer_lat() -> np.ndarray:
    """Latitude of every row in viewer coordinates, shape (NLAT,)."""
    return 90.0 - np.arange(NLAT) * RES


def _lon_to_col(lon: float) -> int:
    return int(round((lon + 180.0) / RES))


def _lat_to_row(lat: float) -> int:
    return int(round((90.0 - lat) / RES))


def europe_window() -> tuple[slice, slice]:
    """Row/col slices covering :data:`EUROPE_EXTENT` in viewer coordinates."""
    lon_min, lon_max, lat_min, lat_max = EUROPE_EXTENT
    r0, r1 = _lat_to_row(lat_max), _lat_to_row(lat_min)  # lat decreases with row
    c0, c1 = _lon_to_col(lon_min), _lon_to_col(lon_max)
    return slice(r0, r1 + 1), slice(c0, c1 + 1)


def to_viewer_array(field_v: np.ndarray) -> np.ndarray:
    """Pre-roll a viewer-coordinate field so the viewer pipeline lands it back.

    ``preprocess_array`` does ``np.roll(arr, NLON // 2, axis=1)``; rolling here
    by the same amount is self-inverse for a 1440-wide grid.
    """
    return np.roll(field_v.astype(np.float32), NLON // 2, axis=1)


# ---------------------------------------------------------------------------
# Field generators (all return float32, shape (NLAT, NLON), zero outside Europe)
# ---------------------------------------------------------------------------

def _blank() -> np.ndarray:
    return np.zeros((NLAT, NLON), dtype=np.float32)


def ramp(diverging: bool, amp: float = 1.0) -> np.ndarray:
    """Smooth horizontal ramp across the Europe window.

    diverging=True  -> -amp (west) .. +amp (east), exercising the *whole* RdBu_r
                       colormap including the white centre.
    diverging=False -> 0 (west) .. +amp (east), exercising the sequential ramp.

    A pure ramp is the cleanest probe for **colormap fidelity**: every hue along
    the colormap appears exactly once, ordered left-to-right.
    """
    arr = _blank()
    rows, cols = europe_window()
    width = cols.stop - cols.start
    t = np.linspace(0.0, 1.0, width, dtype=np.float32)  # 0 west .. 1 east
    line = (2.0 * t - 1.0) * amp if diverging else t * amp
    arr[rows, cols] = line[np.newaxis, :]
    return arr


def _gaussian_blob(arr: np.ndarray, lat: float, lon: float, amp: float, sigma_deg: float) -> None:
    """Add a 2-D Gaussian bump centred at (lat, lon) into ``arr`` (in place)."""
    rows, cols = europe_window()
    lat_g = viewer_lat()[rows][:, None]
    lon_g = viewer_lon()[cols][None, :]
    d2 = (lat_g - lat) ** 2 + (lon_g - lon) ** 2
    arr[rows, cols] += (amp * np.exp(-d2 / (2.0 * sigma_deg ** 2))).astype(np.float32)


def blobs(diverging: bool, amp: float = 1.0) -> np.ndarray:
    """A row of Gaussian blobs whose amplitudes span the normalised range.

    Amplitudes are chosen so that, after per-method max-abs normalisation, the
    blobs land at density fractions ~[0.05, 0.15, 0.3, 0.5, 0.75, 1.0].  This is
    the **opacity / visibility** probe: the faint blobs must fade toward
    transparent (below the shader dead-band) while the strong blobs become fully
    opaque.  In diverging mode the sign alternates so both blue and red appear.
    """
    arr = _blank()
    lon_min, lon_max, lat_min, lat_max = EUROPE_EXTENT
    lat_c = 0.5 * (lat_min + lat_max)
    fractions = [0.05, 0.15, 0.30, 0.50, 0.75, 1.00]
    n = len(fractions)
    # Evenly spaced longitudes across the window interior.
    lons = np.linspace(lon_min + 8, lon_max - 8, n)
    for k, (lon, frac) in enumerate(zip(lons, fractions)):
        sign = 1.0 if (not diverging or k % 2 == 0) else -1.0
        _gaussian_blob(arr, lat_c, float(lon), sign * frac * amp, sigma_deg=2.2)
    return arr


def checkerboard(diverging: bool, amp: float = 1.0) -> np.ndarray:
    """High-frequency checkerboard + single-cell spikes.

    Sharp edges and isolated spikes are the **smoothing** probe: with smoothing
    off the squares are crisp and the spikes are pin-points; with smoothing on
    both should visibly blur.  In diverging mode the squares alternate +/-amp;
    in sequential mode they alternate 0 / +amp (still all >= 0).
    """
    arr = _blank()
    rows, cols = europe_window()
    h = rows.stop - rows.start
    w = cols.stop - cols.start
    cell = 12  # ~3 degrees per square
    ii = (np.arange(h)[:, None] // cell)
    jj = (np.arange(w)[None, :] // cell)
    check = ((ii + jj) % 2).astype(np.float32)
    if diverging:
        block = (check * 2.0 - 1.0) * amp
    else:
        block = check * amp
    arr[rows, cols] = block
    # A few isolated single-cell spikes at full amplitude to test point blur.
    lon_min, lon_max, lat_min, lat_max = EUROPE_EXTENT
    for lon, lat in [(5, 52), (20, 45), (30, 58)]:
        r = _lat_to_row(lat)
        c = _lon_to_col(lon)
        arr[r, c] = amp
    return arr


def alternating_slight(diverging: bool = True, amp: float = 1.0) -> np.ndarray:
    """High-frequency sign flips at *slight* magnitude (diverging only).

    A fine stripe checkerboard (1.0° sign blocks ≈ 28 cycles across the window)
    set to only ~12 % of the field maximum, anchored by two full-amplitude
    Gaussian blobs in opposite corners that fix the per-method max-abs.

    This stresses the **diverging near-zero regime**: every slight value sits
    just inside the alpha dead-band / transparent white centre, and the sign
    flips faster than the viewer's ~0.7°/texel volume grid. The probe asks (a)
    do slight ± values stay faint/pale instead of saturating, (b) do the rapid
    blue/red flips survive or average toward transparent, and (c) do the two
    anchor blobs read as fully saturated blue/red — all against matplotlib
    RdBu_r at native resolution.
    """
    arr = _blank()
    rows, cols = europe_window()
    h = rows.stop - rows.start
    w = cols.stop - cols.start
    block = 4  # grid cells per sign block → 1.0° stripes (resolvable, "quick")
    ii = np.arange(h)[:, None] // block
    jj = np.arange(w)[None, :] // block
    sign = ((ii + jj) % 2).astype(np.float32) * 2.0 - 1.0  # ±1
    slight = 0.12 * amp
    arr[rows, cols] = sign * slight
    # Two opposite-corner anchors at full amplitude set max-abs = amp, so the
    # stripes normalise down to ~12 % (density ≈ 0.5 ± 0.06).
    _gaussian_blob(arr, lat=62.0, lon=-6.0, amp=+amp, sigma_deg=1.6)
    _gaussian_blob(arr, lat=34.0, lon=40.0, amp=-amp, sigma_deg=1.6)
    return arr
