# Installation

Install the model-agnostic `geoxplain` package to inspect arrays and compatible result bundles. Model backends are separate packages and are only needed when this machine must submit or execute explanation computations.

## GeoXplain from this repository

From the GeoXplain checkout:

```bash
uv sync
```

Screenshot capture uses Playwright and is an optional package extra:

```bash
uv sync --extra screenshots
uv run playwright install chromium
```

The second command installs the browser used by `GeoXplain.screenshot()` and `GeoXplainWidget.screenshot()`.


## Optional: Aurora backend

`geoxplain-aurora-adapter` is the first packaged model backend. Install it when you want to compute explanations for Microsoft Aurora or pull ERA5 overlays through its data pipeline. It is not required to use the GeoXplain viewer.

From the adapter checkout, run its interactive setup command through an isolated bootstrap environment:

```bash
uvx --from . geoxplain-aurora-adapter setup
```

The setup command asks which environment and execution profile to configure:

| Profile | Purpose |
| --- | --- |
| `client` | Submit requests to an existing listener. |
| `local` | Compute in a notebook process with a visible GPU. |
| `gpu-listener` | Run the HTTP listener inside an existing GPU allocation. |
| `sbatch` | Run a login-node listener backed by SLURM jobs. |

Preview an adapter setup without changing an environment:

```bash
uvx --from . geoxplain-aurora-adapter setup --dry-run --mode sbatch
```

## Documentation dependencies

The documentation toolchain lives in uv's `dev` dependency group:

```bash
uv sync --group dev
uv run mkdocs serve
```

The documentation site includes a separately labeled Aurora backend section and reads its API reference from the sibling source at `../geoxplain-aurora-adapter`. See [documentation development](../development/documentation.md) for the expected checkout layout and strict build command.

