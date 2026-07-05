# Adapt the adapter to another model

The GeoXplain viewer has no Aurora-specific imports. It recognizes results through the duck-typed contracts described in [architecture](../concepts/architecture.md), so a backend for a regional forecast model, climate emulator, or downscaling system can keep the viewer unchanged and replace only the model-specific computation.

The fastest way to build such a backend is to clone `geoxplain-aurora-adapter` and swap out its Aurora-specific parts. The model-specific surface is intentionally narrow. A backend must provide:

1. a target specification that resolves to a scalar model output,
2. a case loader and batch builder,
3. method runners that produce per-layer attribution grids, and
4. results that satisfy the bundle format from the [data model](../concepts/data-model.md).

Everything else — request dispatch, remote execution over GPU and SLURM listeners, progress reporting, result serialization, and the CLI — is model-independent and carries over unchanged.

## Step 1: Clone and rename

```bash
git clone https://github.com/clemenskoprolin/geoxplain-aurora-adapter my-model-adapter
```

Rename the `geoxplain_aurora_adapter` package and update `pyproject.toml`. The package layout separates what you keep from what you replace:

```text
schema/    targets, result bundles, metadata   → adapt
engine/    model, data, runners, xia_methods   → replace model-specific parts
api/       run_<method> wrappers and dispatch  → mostly keep
remote/    listeners, SLURM, polling, transfer → keep
serving/   CLI and listener configuration      → keep
```

## Step 2: Replace the model and data loading

- `engine/model.py` — `load_model()` constructs the public Aurora model with gradient checkpointing. Replace it with your model constructor; checkpointing is only needed if gradient-based methods exceed memory.
- `engine/data.py` — `load_case()` reads WeatherBench2 zarr stores into a `CaseData` object, and `make_batch()` turns a case into a model input batch. Replace both with your data source and batch format. The rest of the engine only interacts with data through these two functions.

## Step 3: Adapt the data model

The schema package describes what can be explained and how results are labeled:

- `schema/spec.py` — `TargetSpec` names the output variable, pressure level, point or box region, and timestamp. Adjust the fields to your model's outputs: a single-level model can drop `level`, a model with different output heads can add a head selector, and so on.
- `schema/targets.py` — `build_target_fn()` converts a `TargetSpec` and a case into a differentiable `target_fn(pred) → scalar`. This is where a new target type (a different spatial aggregation, a derived quantity, a classification logit) is implemented.
- `schema/metadata.py` — level tables, display names, units, and default colormaps. Replace `AURORA_LEVELS` and the variable tables with your model's variables so the viewer labels layers and overlays correctly.

## Step 4: Replace the method runners

The explanation code lives in two layers:

- `engine/xia_methods/` contains the model-agnostic algorithms (Saliency, Integrated Gradients, RISE, ViT-CX). Each takes a model, a `batch_fn`, and a `target_fn`, so they can usually be reused as-is for any differentiable model. ViT-CX is the exception: it hooks a transformer's patch embeddings, so it only transfers to architectures with a comparable feature map.
- `engine/runners/` contains the Aurora-specific glue around each algorithm: building the batch, wiring the target, fanning perturbation passes across GPUs, and unpacking raw outputs into per-variable, per-level attribution maps. These are the modules to rewrite for a new model.

`engine/compute.py` dispatches to the runners by method id; add or remove entries there when the method set changes. Features that do not apply to your model — autoregressive rollouts (`engine/rollout.py`) or ERA5 overlays (`engine/overlay_compute.py`) — can simply be deleted along with their dispatch entries.

## Step 5: Verify against the viewer contract

The viewer accepts any object with the `XiaResult` shape: `method`, `frames`, `layer_labels`, and `meta`, where each frame carries `timestamp`, `attributions[wrt_var][level_key]` grids, and `diverging` flags. If you keep `schema/result.py` and fill it from your runners, this holds automatically, including `.xia.npz` saving and remote transport.

The end-to-end check requires no viewer changes:

```python
result = run_saliency(target=my_target, input=["t", "q"])

from geoxplain import GeoXplainWidget
GeoXplainWidget(result=result)
```

If the widget renders your layers with the right labels, timestamps, and colormaps, the backend satisfies the protocol — and the saved bundle can be reopened anywhere without your model, PyTorch, or the adapter installed.
