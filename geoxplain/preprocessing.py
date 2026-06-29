"""Shared preprocessing pipeline for saliency arrays.

Both the file-export path (GeoXplain) and the widget path (GeoXplainWidget) use
this module so the two code paths never diverge.
"""

import os
from typing import Union

import numpy as np

from .loader import load_npy


def preprocess_array(
    path_or_array: Union[str, os.PathLike[str], np.ndarray],
) -> np.ndarray:
    """Standard preprocessing pipeline for a 2-D saliency array.

    Load from ``.npy`` / ``.npz`` file if a path string is given & validate.
    Then roll longitude from ``[0°, 360°)`` → ``[−180°, 180°)`` so the viewer's
       equirectangular texture is centred on the prime meridian.

    Returns
    -------
    np.ndarray
        Same shape as the source array, dtype ``float32``.
    """
    if isinstance(path_or_array, (str, os.PathLike)):
        arr = load_npy(os.fspath(path_or_array))
    else:
        arr = np.asarray(path_or_array, dtype=np.float32)

    if arr.ndim != 2:
        raise ValueError(f"Expected 2-D array, got shape {arr.shape}")

    # the viewer expects [−180°, 180°).
    # Roll directly on the native grid so imported detail is preserved.
    arr = np.roll(arr, arr.shape[1] // 2, axis=1)

    return arr
