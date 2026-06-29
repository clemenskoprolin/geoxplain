# Compute with the Aurora backend

GeoXplain does not prescribe how attributions are computed. This guide covers its first packaged backend, `geoxplain-aurora-adapter`, which exposes one function per supported Aurora XAI method. Every function accepts a `TargetSpec`, a list of input variables to attribute, and the same local-or-remote dispatch choice.

## Define the target

A target is the scalar model output being explained. Point targets use the nearest grid point; box targets explain the mean over a rectangular region.

=== "Point"

    ```python
    import geoxplain_aurora_adapter as ax

    target = ax.Target.point(
        var="q",
        level=850,
        lat=46.2,
        lon=8.8,
        timestamp="2024-03-20T00:00:00Z",
    )
    ```

=== "Box"

    ```python
    import geoxplain_aurora_adapter as ax

    target = ax.Target.box(
        var="q",
        level=850,
        lat=46.25,
        lon=8.75,
        size=(1.5, 2.5),
        timestamp="2024-03-20T00:00:00Z",
    )
    ```

For a box, `lat` and `lon` are its center and `size=(dlat, dlon)` is its full extent in degrees. The default extent is `(2.0, 3.0)`. Use `level=None` for a surface output variable.

## Choose a method

| Function | Method-specific options | Default work parameter |
| --- | --- | --- |
| `run_saliency()` | None | One gradient computation |
| `run_ig()` | `n_steps`, `baseline_sigma_deg` | `n_steps=32` |
| `run_rise()` | `n_masks`, `cells_h`, `cells_w`, `seed`, `baseline_sigma_deg` | `n_masks=200` |
| `run_vit_cx()` | `hook_stage`, `n_clusters`, `baseline_sigma_deg` | `n_clusters=256` per input variable |

```python
result = ax.run_ig(
    target=target,
    input=["t", "q", "z"],
    n_steps=32,
    baseline_sigma_deg=2.5,
    remote="http://localhost:8765",
)
```

`input` names the model input fields with respect to which attribution maps are produced. The returned `XiaResult` contains one nested level mapping for every requested input variable.

## Compute consecutive timeframes

All four method functions accept `timeframes` and `step_hours`. The adapter starts at `target.timestamp` and creates `timeframes` targets at increasing `step_hours` intervals.

```python
result = ax.run_saliency(
    target=target,
    input=["t", "q", "z"],
    timeframes=6,
    step_hours=6,
    remote="http://localhost:8765",
)
```

This returns one multi-frame `XiaResult`; it does not return a list of separate results.

## Compute an autoregressive rollout

`run_rollout()` advances Aurora in fixed six-hour steps and explains the rollout frames. The current implementation supports Saliency and Integrated Gradients only.

```python
result = ax.run_rollout(
    target=target,
    input=["t", "q", "z"],
    method="ig",
    timeframes=5,
    n_steps=32,
    remote="http://localhost:8765",
)
```

Passing `method="rise"` or `method="vit_cx"` currently raises `NotImplementedError`.

## Save the result

```python
result.save("ticino-q850-ig.xia.npz")
print(result.summary())
```

The in-memory result can also be passed directly to `GeoXplain` or `GeoXplainWidget`; saving is optional.

See the generated [Aurora adapter API](../reference/aurora-adapter.md) for exact signatures and return types.
