"""Utilities for loading, resampling, and naming NumPy saliency arrays."""

import re

import numpy as np
from scipy.ndimage import zoom


def slugify(name: str) -> str:
    """Convert a human-readable method name to a URL-safe slug.

    Examples::

        slugify('Contrastive Saliency') -> 'contrastive-saliency'
        slugify('Integrated Gradients') -> 'integrated-gradients'
        slugify('grad_cam')             -> 'grad-cam'
    """
    return re.sub(r'[\s_]+', '-', name.strip().lower())


def short_label(name: str) -> str:
    """Derive a 2–3 letter abbreviation from a method name.

    Examples::

        short_label('Contrastive Saliency') -> 'CS'
        short_label('Integrated Gradients') -> 'IG'
        short_label('grad-cam')             -> 'GC'
    """
    words = re.split(r'[\s\-_]+', name.strip())
    return ''.join(w[0].upper() for w in words if w)[:3]


def load_npy(path: str) -> np.ndarray:
    """Load a .npy or .npz file and return a 2-D float32 array.

    For .npz files the first array key is used.
    """
    if path.endswith('.npz'):
        archive = np.load(path)
        key = list(archive.keys())[0]
        arr = archive[key]
    else:
        arr = np.load(path)
    return arr.astype(np.float32)


def resample(arr: np.ndarray, H: int = 256, W: int = 512) -> np.ndarray:
    """Resample a 2-D array to (H, W) using bilinear interpolation."""
    if arr.ndim != 2:
        raise ValueError(f"Expected 2-D array, got shape {arr.shape}")
    zoom_h = H / arr.shape[0]
    zoom_w = W / arr.shape[1]
    return zoom(arr, (zoom_h, zoom_w), order=1).astype(np.float32)
