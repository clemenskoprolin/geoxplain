# Architecture

GeoXplain deliberately separates model-specific computation from model-agnostic visual analysis. The stable center is the viewer and its result protocols, not a particular model or explanation method.

![Model-specific computation on the left, a self-describing result bundle in the middle, and the model-agnostic viewer on the right](../images/overview.png)

*GeoXplain separates interactive visual analysis from model-specific computation. In the notebook (1), the analyst specifies the target and
input variables. The model-specific Aurora adapter (2) turns this target specification into a result bundle containing attribution time frames and
metadata. The model-agnostic GeoXplain viewer (3) renders the bundle in a notebook widget or standalone browser view. This example shows how
the specific humidity at 850 hPa around Zurich is explained using humidity and temperature at 850 and 700 hPa..*

```text
model + explanation code
  custom code or a packaged backend
               |
               v
 raw arrays, XiaResult, or OverlayResult
       in memory or saved file
               |
               v
           geoxplain
  GeoXplainWidget or GeoXplain
               |
               v
      notebook / browser / PNG
```

## Package responsibilities

### `geoxplain`

- Accept raw NumPy arrays, paths, level mappings, or result bundles.
- Normalize and encode grids for the browser renderer.
- Combine methods, timestamps, vertical levels, targets, and overlays.
- Render in Jupyter, export `viewer_data.json`, open a local browser viewer, or capture a PNG.

The viewer does not import a model backend. It recognizes compatible result objects through runtime-checkable protocols, and it also accepts NumPy arrays and level mappings directly.

### Model backends

A backend is responsible for model-specific work: loading inputs, resolving a target to a scalar output, running one or more explanation methods, and packaging the resulting grids. It may return compatible objects in memory or save them for later inspection. Local, GPU-service, and cluster execution are backend concerns rather than viewer concerns.

## Integration boundary

The viewer recognizes two duck-typed contracts:

- A `XiaResult` has `method`, `frames`, `layer_labels`, and `meta`. Each frame has `timestamp`, `attributions`, `diverging`, and `as_widget_dict()`.
- An `OverlayResult` has `variable`, `level`, `frames`, `label`, `unit`, `colormap`, and `visible`. Each frame has `timestamp` and `data`.

This boundary allows a model backend to create compatible results without adding a dependency to the viewer. A backend can omit pressure levels, use custom layer labels, expose different explanation methods, and choose its own execution system as long as it produces the viewer-facing fields.

## First packaged backend: Aurora

`geoxplain-aurora-adapter` is one implementation of that boundary. It defines point and box targets for Aurora, runs Saliency, Integrated Gradients, RISE, ViT-CX, and autoregressive explanations, pulls ERA5 overlays, and dispatches the same calls locally or through GPU and SLURM-backed listeners.

Nothing in the GeoXplain viewer requires Aurora-specific imports. A backend for a regional forecast model, climate emulator, or downscaling system can keep the same viewer while replacing the target resolver, data loader, and model forward wrapper. See [Aurora as a backend](../backends/aurora.md) for the concrete first integration.
