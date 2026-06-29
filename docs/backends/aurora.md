# Aurora as a GeoXplain backend

The Aurora adapter is the first packaged computation backend for GeoXplain. GeoXplain itself remains responsible for loading, comparing, and presenting explanation results; `geoxplain-aurora-adapter` supplies the model-specific target, data, method, and execution logic for Microsoft Aurora.

```text
TargetSpec
    |
    v
geoxplain-aurora-adapter
  Aurora + ERA5 + XAI method
    |
    v
XiaResult / OverlayResult
    |
    v
geoxplain viewer or widget
```

## What the backend provides

- Point and box targets over Aurora output variables.
- Saliency, Integrated Gradients, RISE, and ViT-CX computations.
- Consecutive target time frames and autoregressive rollouts.
- ERA5 weather-field overlays.
- The same Python call for in-process, GPU-listener, and SLURM-backed execution.

These capabilities are specific to the Aurora package. The returned result objects satisfy GeoXplain's generic protocols and can be saved, shared, and reopened without installing Aurora, PyTorch, CUDA, or the adapter.

## Typical flow

```python
import geoxplain_aurora_adapter as ax
from geoxplain import GeoXplainWidget

target = ax.Target.point(
    var="q",
    level=850,
    lat=46.2,
    lon=8.8,
    timestamp="2024-03-20T00:00:00Z",
)

result = ax.run_saliency(
    target=target,
    input=["t", "q", "z"],
    remote="http://localhost:8765",
)

GeoXplainWidget(result=result)
```

From here, use [compute attributions](../guides/compute-attributions.md) for targets and method calls, [attribution methods](../concepts/methods.md) for implemented behavior and cost controls, and [remote execution](../guides/remote-execution.md) for listener deployment.
