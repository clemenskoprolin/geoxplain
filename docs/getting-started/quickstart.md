# Quickstart

The shortest path is to load a self-describing `.xia.npz` result and hand it to either GeoXplain frontend. The bundle may come from any backend that implements the result format; no model package is needed to inspect it.

## Jupyter widget

```python
from geoxplain import GeoXplainWidget
from geoxplain.xia_result import load_xia_result

result = load_xia_result("case.xia.npz")
widget = GeoXplainWidget(result=result, height=700)
widget
```

The result supplies its method name, timestamps, targets, layer labels, and attribution arrays. Do not repeat those values in `add_attribution()` when passing a result bundle.

## Standalone viewer

```python
from geoxplain import GeoXplain
from geoxplain.xia_result import load_xia_result

result = load_xia_result("case.xia.npz")
viewer = GeoXplain(result=result, title="Ticino attribution")

with viewer.open() as handle:
    print(handle.url)
    input("Press Enter to stop the local viewer server...")
```

`open()` serves a temporary copy of the packaged browser application. The returned handle owns the HTTP server and temporary directory; closing it releases both.

## Add more data

All mutating viewer methods return the viewer, so calls can be chained:

```python
from geoxplain.overlay_result import load_overlay_result

overlay = load_overlay_result("humidity.overlay.npz")

widget.add_attribution(result).add_overlay(overlay).set_options(
    map_type="globe",
    view_mode="contours",
)
```

!!! tip "Avoid a duplicate view"

    Because these methods return the widget, ending a notebook cell with a
    bare mutating call renders a *second* copy of an already-displayed widget.
    When the widget is already shown in another cell, end the line with a
    semicolon to suppress that extra output:

    ```python
    widget.add_overlay(overlay);
    ```

Continue with [visualize results](../guides/visualize-results.md) for raw arrays and level mappings. If Aurora is your model backend, see the [Aurora backend overview](../backends/aurora.md) before computing a new result.
