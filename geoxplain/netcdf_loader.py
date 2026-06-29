"""Load weather field variables from NetCDF4 files (ERA5 / WeatherBench2 format).

Requires xarray (and either netCDF4 or h5netcdf as the engine — both work with
WeatherBench2 NC4 files).  These ship in the optional ``netcdf`` extra:
    pip install "geoxplain[netcdf]"   # or, with uv: uv sync --extra netcdf

The returned arrays are already longitude-rolled from [0°, 360°) to [-180°, 180°)
via the same :func:`~geoxplain.preprocessing.preprocess_array` pipeline used
by the attribution path, so coordinates are consistent throughout the viewer.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    pass

_KNOWN_TIME_DIMS = ('time', 'valid_time', 'forecast_time', 'step')


def _find_time_dim(ds) -> str | None:  # type: ignore[type-arg]
    for name in _KNOWN_TIME_DIMS:
        if name in ds.dims:
            return name
    for name in ds.dims:
        if 'time' in name.lower():
            return name
    return None


def load_netcdf_variable(
    path: str,
    variable: str,
) -> tuple[np.ndarray, list[str]]:
    """Load a single variable from a NetCDF4 file and return it as float32 arrays.

    The file is expected to follow the WeatherBench2 / ERA5 convention:
    dimensions ``time × latitude × longitude`` (no pressure-level dimension — ERA5
    pressure levels are encoded in the variable name, e.g. ``specific_humidity_850hPa``).

    Longitude handling:
        Aurora / ERA5 files use ``[0°, 360°)`` ordering.  This function **does not**
        roll the longitude axis — that is deferred to
        :func:`~geoxplain.preprocessing.preprocess_array` so the caller
        (``GeoXplain.import_overlay``) can apply the same shared pipeline.

    Parameters
    ----------
    path:
        Path to a ``.nc`` / ``.nc4`` file readable by xarray.
    variable:
        Name of the xarray variable to load (e.g. ``'specific_humidity_850hPa'``
        or ``'2m_temperature'``).

    Returns
    -------
    arrays:
        Float32 array of shape ``(T, H, W)`` where T is the number of time steps.
        A 2-D file (no time dimension) is promoted to shape ``(1, H, W)``.
    timestamps:
        List of ISO-8601 strings for each time step.  If the file has no time
        dimension the list contains a single empty string ``''``.

    Raises
    ------
    ImportError
        If neither ``netCDF4`` nor ``h5netcdf`` is available.
    KeyError
        If *variable* is not present in the dataset.
    ValueError
        If the loaded array is not 2-D or 3-D after squeezing.
    """
    try:
        import xarray as xr
    except ImportError as exc:
        raise ImportError(
            'Loading NetCDF files requires the optional "netcdf" extra (xarray + netCDF4). '
            'Install it with: pip install "geoxplain[netcdf]"   '
            '(or, with uv: uv sync --extra netcdf)'
        ) from exc

    # Try engines in preference order; fall back gracefully.
    engines = ['netcdf4', 'h5netcdf', 'scipy']
    ds = None
    last_err: Exception | None = None
    for engine in engines:
        try:
            ds = xr.open_dataset(path, engine=engine)
            break
        except Exception as e:  # noqa: BLE001
            last_err = e
    if ds is None:
        raise RuntimeError(
            f'Could not open {path!r} with any available engine '
            f'(tried: {engines}). Last error: {last_err}\n'
            'Install a NetCDF engine with the optional extra: pip install "geoxplain[netcdf]"   '
            '(or, for the pure-Python engine: pip install h5netcdf)'
        )

    if variable not in ds:
        available = sorted(str(v) for v in ds.data_vars)
        raise KeyError(
            f'Variable {variable!r} not found in {path!r}. '
            f'Available variables: {available}'
        )

    da = ds[variable]

    # Squeeze out any length-1 dims that aren't lat/lon/time
    da = da.squeeze(
        [d for d in da.dims if d not in ('latitude', 'longitude', 'lat', 'lon') + _KNOWN_TIME_DIMS and da.sizes[d] == 1],
        drop=True,
    )

    time_dim = _find_time_dim(ds)

    if time_dim and time_dim in da.dims:
        arr = da.values.astype(np.float32)
        if arr.ndim == 2:
            arr = arr[np.newaxis]
        elif arr.ndim != 3:
            raise ValueError(
                f'Variable {variable!r} has unexpected shape {arr.shape} after squeeze. '
                'Expected (time, latitude, longitude).'
            )
        # Extract ISO timestamps
        time_values = ds[time_dim].values
        timestamps: list[str] = []
        for tv in time_values:
            try:
                # numpy datetime64 → ISO string
                ts = str(np.datetime_as_string(np.datetime64(tv, 's'))) + 'Z'
                timestamps.append(ts)
            except Exception:  # noqa: BLE001
                timestamps.append('')
    else:
        arr = da.values.astype(np.float32)
        if arr.ndim == 2:
            arr = arr[np.newaxis]
        elif arr.ndim != 3:
            raise ValueError(
                f'Variable {variable!r} has shape {arr.shape} — expected 2-D (H, W).'
            )
        timestamps = ['']

    ds.close()
    return arr, timestamps
