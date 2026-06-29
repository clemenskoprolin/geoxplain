"""
Quickstart: import XAI attribution maps into the GeoXplain browser viewer.

This is the file-export (``GeoXplain``) counterpart of ``quickstart.ipynb``.
The notebook uses ``GeoXplainWidget`` to render inline in Jupyter; here we build
the same data and open it in a standalone browser viewer.

Run from the examples/ directory:
    python quickstart.py
"""

import sys
import os

# Allow running from this directory without installing the package
sys.path.insert(0, os.path.dirname(__file__))

import numpy as np

from geoxplain import GeoXplain


# ---------------------------------------------------------------------------
# Import bundles — load self-contained .xia.npz / .overlay.npz results
# ---------------------------------------------------------------------------

from geoxplain.xia_result import load_xia_result
from geoxplain.overlay_result import load_overlay_result

attribution = load_xia_result('zurich.xia.npz')
overlay = load_overlay_result('zurich.overlay.npz')

v = GeoXplain()
v.add_attribution(attribution)
v.add_overlay(overlay)

# Open the packaged browser viewer (Ctrl-C / Enter to stop the local server):
with v.open() as handle:
    print("Open " + handle.url + " to see the browser view")
    input("Press Enter to stop the local viewer server...")


# ---------------------------------------------------------------------------
# Optional: import manually
# ---------------------------------------------------------------------------
# Allows for custom timestamp, target, overlay, ... Data is not taken out of
# file metadata. The .npy grids below were extracted from the first rollout
# frame (specific humidity, q) of zurich_rollout_cut.xia.npz.

v_manual = GeoXplain()

grids = {
    'z-1': 'zurich_rollout_q_925hPa.npy',  # orders by z-index automatically
    'z-2': 'zurich_rollout_q_850hPa.npy',
}
layer_labels = {
    'z-1': '925 hPa',
    'z-2': '850 hPa',
}

v_manual.add_attribution(
    grids,
    method='Integrated Gradients',
    timestamp='2024-07-15T18:00:00Z',
    target={'south': 46.88, 'west': 7.74, 'north': 47.88, 'east': 9.34},
    layer_labels=layer_labels,
)

# First frame extracted from zurich.overlay.npz (specific humidity, 850 hPa).
humidity = np.load('zurich_overlay_q850_frame0.npy')  # (721, 1440)
v_manual.add_overlay(
    humidity,
    name='Specific Humidity 850 hPa',
    unit='kg/kg',
    colormap='viridis',
    timestamps=['2024-07-15T12:00:00Z'],
)

# v_manual.open()  # uncomment to view this one instead


# ---------------------------------------------------------------------------
# Reading from NumPy objects
# ---------------------------------------------------------------------------
# No files needed — pass plain in-memory arrays straight to the viewer.
# Useful for model outputs or any 2-D field you already have. Here we build
# artificial Gaussian blobs.

# Build a synthetic global grid (lat 90 -> -90, lon 0 -> 360)
H, W = 721, 1440
lat_vals = np.linspace(90, -90, H)
lon_vals = np.linspace(0, 360, W, endpoint=False)
lon_grid, lat_grid = np.meshgrid(lon_vals, lat_vals)

# A diverging Gaussian blob centred over Europe
sigma = 5.0
blob_pos = np.exp(-((lat_grid - 47) ** 2 + (lon_grid - 20) ** 2) / (2 * sigma ** 2))
blob_neg = -0.6 * np.exp(-((lat_grid - 52) ** 2 + (lon_grid - 30) ** 2) / (2 * sigma ** 2))
synthetic = (blob_pos + blob_neg).astype(np.float32)

v_blob = GeoXplain()

# Attribution straight from in-memory arrays, one grid per level
v_blob.add_attribution(
    {
        'z-2': synthetic,
        'z-3': synthetic * 0.8,
        'z-5': synthetic * 0.5,
    },
    method='Synthetic Blob',
    layer_labels={'z-2': '850 hPa', 'z-3': '700 hPa', 'z-5': '500 hPa'},
)

# v_blob.open()  # uncomment to view this one instead
