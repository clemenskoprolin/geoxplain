# Aurora adapter Python API

This backend-specific reference is generated from the sibling `geoxplain-aurora-adapter` checkout used to build the site. These APIs target Microsoft Aurora; they are separate from the model-agnostic [GeoXplain Python API](geoxplain.md). The package's root exports these target, compute, result, overlay, and listener APIs.

## Targets

::: geoxplain_aurora_adapter.schema.spec.Target

::: geoxplain_aurora_adapter.schema.spec.TargetSpec
    options:
      members:
        - point
        - box
        - box_bounds
        - to_dict
        - from_dict
        - as_widget_dict

## Compute methods

::: geoxplain_aurora_adapter.api.methods.run_saliency

::: geoxplain_aurora_adapter.api.methods.run_ig

::: geoxplain_aurora_adapter.api.methods.run_rise

::: geoxplain_aurora_adapter.api.methods.run_vit_cx

::: geoxplain_aurora_adapter.api.methods.run_rollout

## Weather overlays

::: geoxplain_aurora_adapter.api.methods.pull_overlay

## Attribution results

::: geoxplain_aurora_adapter.schema.result.XiaFrame
    options:
      members:
        - as_widget_dict

::: geoxplain_aurora_adapter.schema.result.XiaResult
    options:
      members:
        - single
        - save
        - load
        - to_msgpack
        - from_msgpack
        - summary

## Overlay results

::: geoxplain_aurora_adapter.schema.overlay.OverlayFrame

::: geoxplain_aurora_adapter.schema.overlay.OverlayResult
    options:
      members:
        - timestamps
        - arrays
        - save
        - load
        - to_msgpack
        - from_msgpack
        - summary

## Listener

::: geoxplain_aurora_adapter.api.listener.listen_for_request
