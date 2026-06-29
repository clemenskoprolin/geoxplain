# Command line

The model-agnostic `geoxplain` package has no command-line entry point. This page documents the separate `geoxplain-aurora-adapter` backend command.

## Setup

```bash
geoxplain-aurora-adapter setup
```

Interactive setup selects the destination environment and one of the `client`, `local`, `gpu-listener`, or `sbatch` profiles. Useful discovery and preview commands are:

```bash
geoxplain-aurora-adapter setup --help
geoxplain-aurora-adapter setup --dry-run --mode sbatch
```

Running setup through `uvx --from .` or `pipx` keeps the bootstrap installer separate from the configured runtime environment.

## Listener

```bash
geoxplain-aurora-adapter listen
```

On first use, the command asks for listener mode, SLURM settings when applicable, data locations, and network settings. It persists those answers in `~/.config/geoxplain-aurora-adapter/listen.toml`.

```bash
geoxplain-aurora-adapter listen --help
geoxplain-aurora-adapter listen --reset
```

CLI flags override persisted configuration for one invocation. `--reset` discards the saved listener configuration and restarts interactive setup.

## Python listener entry point

Library code can start a listener with `geoxplain_aurora_adapter.listen_for_request()`, but the CLI is preferred for normal operation because it resolves and displays the persisted runtime configuration.
