# Attribution methods in the Aurora backend

This page documents the methods implemented by `geoxplain-aurora-adapter`, not a fixed method set imposed by GeoXplain. Other backends may produce results from different explanation libraries or algorithms; the viewer displays their method labels through the same result protocol.

The Aurora backend exposes four single-step methods and one rollout dispatcher. The sections below describe their implemented behavior and the parameters that primarily control cost.

## Saliency

`run_saliency()` computes the gradient of the scalar target with respect to each requested input field. Requested variables share one forward/backward computation.

Saliency has no method-specific public parameter. It is the simplest starting point for checking the complete computation and visualization path.

## Integrated Gradients

`run_ig()` integrates gradients along a path from a spatially smoothed baseline to the input. The implementation uses the midpoint Riemann rule.

- `n_steps=32` controls the number of integration samples.
- `baseline_sigma_deg=2.5` controls Gaussian baseline smoothing in latitude degrees.

Increasing `n_steps` increases compute approximately linearly.

## RISE

`run_rise()` repeatedly masks input regions and measures the target response.

- `n_masks=200` is the number of random masks.
- `cells_h=18` and `cells_w=36` define the low-resolution random mask grid before upsampling.
- `seed=42` controls mask generation.
- `baseline_sigma_deg=2.5` controls the replacement baseline.

RISE runs separately for each requested input variable, so both `n_masks` and the number of input variables affect cost.

## ViT-CX

`run_vit_cx()` extracts Aurora encoder features, clusters spatial tokens, and measures target changes under cluster occlusion.

- `hook_stage=2` selects encoder stage 0, 1, or 2.
- `n_clusters=256` fixes the cluster budget and therefore the number of occlusion forwards per input variable.
- `baseline_sigma_deg=2.5` controls the replacement baseline.

Like RISE, ViT-CX runs separately per requested input variable.

## Rollout

`run_rollout()` repeatedly advances Aurora by six hours and attributes the resulting autoregressive frames. The current implementation accepts `method="saliency"` and `method="ig"`. Its `timeframes` argument is required.

`timeframes` on the ordinary `run_*` functions and `run_rollout()` are not interchangeable: the former computes targets at separate timestamps, while rollout feeds each prediction into the next model step.
