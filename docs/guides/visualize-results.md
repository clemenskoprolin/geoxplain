# Visualize results

`GeoXplainWidget` embeds the viewer in a Jupyter cell. `GeoXplain` maintains the same data model but exports or serves the standalone browser application. Both inherit their data-manipulation methods from `GeoXplainBase`.

## Choose a frontend

| Frontend | Best for | Frontend-specific methods |
| --- | --- | --- |
| `GeoXplainWidget` | Jupyter notebooks | `screenshot()`, `close()` |
| `GeoXplain` | Scripts and standalone browser use | `open()`, `export()`, `export_browser()`, `remove_export()`, `screenshot()` |

## Add attribution data

`add_attribution()` accepts four source shapes:

| Source | Required metadata | Important restrictions |
| --- | --- | --- |
| 2-D NumPy array | Exactly one of `level` or `pressure_level` | `layer_labels` is not accepted; use `label`. |
| `.npy` path | Exactly one of `level` or `pressure_level` | Same rules as an array. |
| `{level_id: array_or_path}` mapping | Level IDs are the mapping keys | Do not also pass `level`, `pressure_level`, or `label`. |
| `XiaResult`-compatible object | Metadata comes from the bundle | Do not override level, method, timestamp, target, or labels. `colormap` and `norm` may be overridden. |

### Single grid

```python
import numpy as np
from geoxplain import GeoXplainWidget

grid = np.load("saliency_q850.npy")

widget = GeoXplainWidget()
widget.add_attribution(
    grid,
    pressure_level=850,
    method="Saliency (q)",
    timestamp="2024-03-20T00:00:00Z",
    target=(46.25, 8.75),
)
widget
```

### Multiple levels

```python
widget.add_attribution(
    {
        "z-2": "saliency_q850.npy",
        "z-3": "saliency_q700.npy",
        "sfc": "saliency_msl.npy",
    },
    method="Saliency",
    layer_labels={
        "z-2": "850 hPa",
        "z-3": "700 hPa",
        "sfc": "Surface",
    },
)
```

Valid level keys are `"sfc"` and `"z-<integer>"`.

## Choose a normalization scope

The `norm` argument of `add_attribution()` selects how the attribution color range is normalized. It is a viewer-wide display setting (the last call wins) and works for every source shape, including `.xia` result bundles:

```python
widget.add_attribution(result, norm="all-methods")
```

| `norm` | Color range spans |
| --- | --- |
| `"global"` (default) | One method, across all its frames |
| `"all-methods"` | Every method and frame — best for comparing attribution magnitudes between methods |
| `"per-frame"` | One method, one frame at a time |
| `"per-frame-all-methods"` | One frame across all methods (frames are matched by timestamp) |
| `"per-level"` | Each vertical level uses its own max |

Each level is exported at its own maximum absolute value together with that value, so the viewer rescales on the fly: the scope can also be changed interactively in the viewer under **Layers → Appearance → Normalization**, without re-exporting. The legend shows the raw-value magnitude the color range corresponds to under the selected scope. Passing `norm=None` (the default) keeps the current setting.

## Specify targets

Raw attribution imports accept these target forms:

```python
target=(46.25, 8.75)                         # point: lat, lon
target=(45.5, 7.5, 47.0, 10.0)              # box: south, west, north, east
target={"lat": 46.25, "lon": 8.75}          # point dictionary
target={"south": 45.5, "west": 7.5,
        "north": 47.0, "east": 10.0}        # box dictionary
```

Box dictionaries may alternatively use `latMin`, `lonMin`, `latMax`, and `lonMax`. Longitudes are normalized to `[-180, 180)`.

## Configure appearance

```python
widget.set_title("Ticino humidity attribution")
widget.set_subtitle("Weather model · 20 March 2024 · 850 hPa")
widget.set_options(
    map_type="globe",
    view_mode="contours",
    basemap="satellite",
    smooth=True,
    smooth_imported_grid_sigma=1.2,
)
```

`view_mode="heatmap"` and `view_mode="contours"` select the attribution depiction. `map_type="map"` and `map_type="globe"` select the renderer. `basemap` accepts `"topo"` or `"satellite"`.

!!! tip "Avoid a duplicate view"

    Every mutating method (`add_attribution()`, `add_overlay()`, `set_options()`,
    `set_title()`, …) returns the widget so calls can be chained. In a Jupyter
    notebook this means ending a cell with a bare mutating call re-renders an
    already-displayed widget as a second copy. End the line with a semicolon to
    suppress that extra output:

    ```python
    widget.set_options(map_type="globe");
    ```

Attribution colormap presets are `default`, `rdbu`, `coolwarm`, `purple-green`, `reds`, `viridis`, `plasma`, `magma`, `inferno`, and `cividis`. A custom attribution colormap is a sequence of two to eight hex colors, or `(position, color)` pairs with strictly increasing positions from zero to one.

## Open the widget viewer in a browser tab

The `GeoXplainWidget` "Open in browser" button launches the same viewer full-screen in a separate tab. It can be served two ways, and `live_browser_export` controls which:

- **Static `/files` URL** — served by the Jupyter server itself, on the same host and port you already use for the notebook. Nothing extra to forward.
- **Local preview server** — a short-lived server on its own port that can additionally push imported-data updates into an already-open tab (live sync).

By default (`live_browser_export=None`) the widget **auto-detects** which to use:

| Where you run | What happens |
| --- | --- |
| Local laptop session | Local preview server (live sync available) |
| Remote Jupyter over an **SSH port-forward** | Static `/files` URL — reuses your existing forwarded port, so the button works with no second tunnel |
| VSCode (Remote) notebooks | Local preview server (VSCode forwards the port itself) |

The remote case is detected by comparing the browser's origin against the Jupyter server's own bound host: a loopback browser origin (`127.0.0.1`) while the server is bound to a remote host means you reached it through a forward, so an ad-hoc preview port would not be reachable.

Override the auto-detection when you need to:

```python
# Force the static /files URL (e.g. you don't want any extra port; no live sync):
GeoXplainWidget(live_browser_export=False)

# Force the live preview server (e.g. on a remote box where you HAVE forwarded
# the preview port yourself and want live imported-data syncing):
GeoXplainWidget(live_browser_export=True)
```

> When the preview server is used on a remote session, forward its port too — e.g. `ssh -L 8765:localhost:8765 <login-node>` — or the button's URL will not resolve in your browser.

## Open or export the standalone viewer

By default `GeoXplain` keeps everything in memory and writes nothing to disk until you ask it to. The usual path is `open()`, which stages a temporary packaged browser build, serves it from `127.0.0.1`, and opens it:

```python
from geoxplain import GeoXplain

viewer = GeoXplain()
viewer.add_attribution(result)

with viewer.open() as handle:
    print(handle.url)
    input("Press Enter to stop the local viewer server...")
# The server and its temporary files are released when the block exits.
```

For a static artifact, export explicitly. `export()` requires a path and writes a single `viewer_data.json`; `export_browser()` writes a self-contained directory (the packaged browser app plus its `viewer_data.json`) that any static host can serve:

```python
json_path = viewer.export("exports/viewer_data.json")
index_html = viewer.export_browser("exports/my_case")  # → exports/my_case/index.html
```

Pass `out_path` to the constructor to opt into the legacy behavior where every mutation re-writes that JSON file; `remove_export()` then deletes it. Without `out_path`, `remove_export()` is a no-op and nothing is auto-written.

## Capture a screenshot

```python
path = widget.screenshot(
    "screenshots/ticino.png",
    width=1400,
    height=900,
)
```

Screenshot capture requires the `screenshots` extra and a Playwright Chromium installation. The image contains the visualization, targets, and overlays but hides UI controls.
