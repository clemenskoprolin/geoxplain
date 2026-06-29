# Data model and file formats

## Attribution levels

Attributions are organized as:

```python
attributions[input_variable][level_id] = array_2d
```

Atmospheric level identifiers use `"z-<integer>"`; `"sfc"` is reserved for surface data. A higher integer renders at a higher vertical position. Backends may attach any human-readable labels to these IDs. For convenience, `add_attribution(..., pressure_level=...)` maps these common pressure levels to the built-in vertical order:

`1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 50` hPa.

## `XiaResult`

An attribution bundle contains:

- `method`: the computation method label.
- `frames`: one or more timestamped `XiaFrame` objects.
- `layer_labels`: display labels keyed by level identifier.
- `meta`: bundle-level diagnostics.

Each frame stores its target, timestamp, nested attribution mapping, diverging flag, and per-frame metadata. The viewer preprocesses arbitrary two-dimensional imported grids. A backend may therefore use its native regular-grid resolution; the Aurora backend, for example, produces `(721, 1440)` `float32` fields.

Compatible bundles can be saved as `.xia.npz` archives. The viewer loads them without importing the backend that produced them:

```python
from geoxplain.xia_result import load_xia_result

result = load_xia_result("case.xia.npz")
```

## `OverlayResult`

An overlay bundle describes one weather variable and contains timestamped two-dimensional arrays plus its label, unit, colormap, and initial visibility. Compatible overlay files use the `.overlay.npz` suffix.

```python
from geoxplain.overlay_result import load_overlay_result

overlay = load_overlay_result("humidity.overlay.npz")
```

## Transport format

Saved bundles are zip-based NPZ containers with JSON metadata and one `.npy` member per grid.

Treat both persisted layouts as versioned interchange formats. Prefer the package `save()` and `load()` methods over reading archive members directly.

Transport is backend-specific. The Aurora backend, for example, serializes equivalent results with msgpack as `application/octet-stream`; its client converts the response back into an in-memory result before GeoXplain sees it.
