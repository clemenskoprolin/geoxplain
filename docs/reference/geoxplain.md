# GeoXplain Python API

The documented surface below is generated from the current Python source. It is model-agnostic and has no dependency on a computation backend. `GeoXplainBase` owns the shared mutation API; the two concrete frontends add their own presentation methods.

## Shared viewer API

::: geoxplain._base.GeoXplainBase
    options:
      members:
        - add_attribution
        - clear_attributions
        - add_overlay
        - clear_overlays
        - set_title
        - set_subtitle
        - set_options
        - clear

## Standalone viewer

::: geoxplain.viewer.GeoXplain
    options:
      members:
        - export_path
        - export
        - export_browser
        - remove_export
        - screenshot
        - open

::: geoxplain.viewer.GeoXplainOpenHandle
    options:
      members:
        - close

## Jupyter widget

::: geoxplain.widget.GeoXplainWidget
    options:
      members:
        - screenshot
        - close

## Attribution result protocol and loader

::: geoxplain.xia_result.XiaFrameProtocol

::: geoxplain.xia_result.XiaFrameFile
    options:
      members:
        - as_widget_dict

::: geoxplain.xia_result.XiaResultProtocol

::: geoxplain.xia_result.XiaResultFile

::: geoxplain.xia_result.load_xia_result

## Overlay result protocol and loader

::: geoxplain.overlay_result.OverlayFrameProtocol

::: geoxplain.overlay_result.OverlayFrameFile

::: geoxplain.overlay_result.OverlayResultProtocol

::: geoxplain.overlay_result.OverlayResultFile

::: geoxplain.overlay_result.load_overlay_result
