# Visual parity test suite

Confirms the WebGL GeoXplain web viewer reproduces the **colormap**, **opacity**, and
**smoothing** behaviour of the canonical matplotlib/cartopy attribution plots.

For each synthetic debug field it renders a **matplotlib reference** (ground
truth) and a **screenshot of the live viewer** showing the *same* data, then
stitches them into a labelled side-by-side image.

## Run

```bash
uv sync                      # base deps
uv pip install matplotlib pillow playwright
python -m playwright install chromium

python -m tests.visual_test        # full run -> tests/visual_test/output/
python -m tests.visual_test --no-shots   # references only, skip the browser
python -m tests.visual_test --settle-ms 12000   # wait longer before screenshots
```

Outputs land in `tests/visual_test/output/`:

- `reference_<case>__<capture>.png` — matplotlib ground truth
- `viewer_<case>__<capture>.png` — raw live-viewer screenshot
- `compare_<case>__<capture>.png` — the side-by-side an evaluator reads

> **Side effect:** the run overwrites `viewer/public/viewer_data.json` with the
> synthetic debug data. Re-run `python example_usage.py` to restore your data.

## What is tested

| aspect    | diverging field          | sequential field         |
|-----------|--------------------------|--------------------------|
| colormap  | signed ramp (−1..+1)     | magnitude ramp (0..1)    |
| opacity   | blobs, amps 0.05..1.0    | blobs, amps 0.05..1.0    |
| smoothing | checkerboard + spikes (off/on) | checkerboard + spikes (off/on) |
| alternating-sign | high-freq slight ± stripes + corner anchors | — |

- **colormap** — a pure spatial ramp puts every hue on screen once; compare the
  viewer's GLSL ramp against true matplotlib `RdBu_r` / `Reds`.
- **opacity** — blobs spanning the normalised range probe the alpha transfer:
  faint values must fade out, strong values become opaque, monotonically.
- **smoothing** — sharp checkerboard + pin-point spikes captured with the
  viewer's "smooth imported grids" toggle OFF and ON, each against the raw and
  Gaussian-blurred reference.

## How the comparison is kept fair

- **Colour is independent.** The reference uses real matplotlib colormaps; the
  viewer uses a hand-tuned GLSL approximation. Colour fidelity is honestly
  tested.
- **Alpha follows the viewer spec.** Transparency is a viewer design choice, so
  the reference applies the *same* opacity transfer as the GLSL shader
  (`viewer/src/shaders/shared.ts::densityToColor`) over a neutral background,
  making the two images directly comparable.
- **Normalisation matches the exporter** (`geoxplain/exporter.py`).
- **Deterministic viewer state.** Each screenshot is driven by a complete
  `?state=` launch URL (`viewer/src/lib/launchState.ts`): map mode, topo tiles,
  pitch 0, single `z-3` level, smoothing on/off.

### Known, expected differences

- Background: neutral grey (reference) vs. MapLibre topo tiles (viewer).
- Projection: linear lon/lat (reference) vs. Web-Mercator (viewer) — minor over
  Europe.
- The viewer applies a perceptual `pow(density, 0.65)` to the *colour* lookup of
  the sequential ramp; the reference does not.
- The live-viewer screenshot is centre-cropped to the data region (the viewer
  auto-zooms to the data bounds, leaving the field centred in the viewport).

## Files

| file           | role |
|----------------|------|
| `synthetic.py` | debug-field generators + geographic placement |
| `reference.py` | matplotlib ground-truth renderer |
| `cases.py`     | case catalogue + `?state=` launch-URL builder |
| `capture.py`   | Vite dev server + Playwright screenshots |
| `compose.py`   | side-by-side compositing |
| `run.py`       | end-to-end orchestrator (`python -m visual_test`) |
