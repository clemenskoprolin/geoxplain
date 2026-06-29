# Third Party Notices

GeoXplain source code is licensed under the MIT License. This
file records third-party material that may be installed, bundled, displayed, or
used alongside GeoXplain. These notices are informational and do not change the
project license.

## Bundled Viewer Dependencies

The `geoxplain` wheel includes compiled frontend assets built from `viewer/`.
Those bundles may include code or assets from the following projects, each under
its own license:

- React and React DOM, MIT License.
- Base UI, MIT License.
- class-variance-authority, Apache License 2.0.
- clsx, MIT License.
- lucide-react, ISC License.
- MapLibre GL JS, BSD 3-Clause License. MapLibre GL JS also carries notices for
  Mapbox GL JS v1.13 and other included components.
- react-globe.gl, MIT License.
- shadcn, MIT License.
- tailwind-merge, MIT License.
- tw-animate-css, MIT License.
- Geist via `@fontsource-variable/geist`, SIL Open Font License 1.1.
- Three.js may be included transitively through globe rendering dependencies,
  MIT License.

Development and build-time tools such as Vite, TypeScript, ESLint, and Tailwind
CSS are installed from package managers under their own licenses.

## Python Dependencies

GeoXplain depends on Python packages that are installed separately by the user's
package manager and retain their own licenses. Direct runtime and optional
dependencies include NumPy, SciPy, anywidget, traitlets, requests, Jupyter
components, Playwright, xarray, and netCDF4.

## Basemaps and Imagery

The viewer can display third-party basemap and imagery layers. In-app
attribution is shown by the viewer and should be preserved where required by
the providers:

- CARTO and OpenStreetMap contributors for the standard map basemap.
  OpenStreetMap data is available under the Open Database License.
- Esri, Vantor, Earthstar Geographics, and the GIS User Community for satellite
  imagery.

Screenshots or exported views that include these layers may remain subject to
the applicable map-data, tile-service, and imagery attribution requirements.

## Colormaps

The viewer includes scientific color ramps inspired by or derived from common
visualization palettes, including Matplotlib/viscm perceptually uniform
colormaps and ColorBrewer-style schemes.

ColorBrewer software and ColorBrewer color schemes are licensed under the
Apache License, Version 2.0, with the following acknowledgment requested by the
ColorBrewer license:

"This product includes color specifications and designs developed by Cynthia
Brewer (http://colorbrewer.org/)."

## Data, Models, and Result Bundles

The MIT License for GeoXplain applies to the project code unless otherwise
stated. It does not automatically apply to third-party weather data, model
weights, map data, imagery, or generated `.xia.npz` / `.overlay.npz` result
bundles. Review the source licenses for datasets and models before
redistributing those artifacts.
