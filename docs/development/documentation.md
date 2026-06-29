# Documentation development

The documentation lives in the GeoXplain repository. Core viewer material and Aurora backend material have separate navigation sections, while API reference for both packages is generated from source.

## Checkout layout

The mkdocstrings search paths expect sibling repositories:

```text
workspace/
  geoxplain/
    mkdocs.yml
    docs/
  geoxplain-aurora-adapter/
```

The local directory may still have an older name; only the relative sibling relationship matters. A strict build fails if the adapter source is unavailable, which prevents publishing a partial shared reference by accident.

## Install and serve

```bash
uv sync --group dev
uv run mkdocs serve
```

MkDocs watches the GeoXplain pages and source. Restart the server after changing adapter source if a change is not detected automatically.

## Strict build

```bash
uv run python docs/_tooling/generate_llm_reference.py
uv run mkdocs build --strict
```

The first command writes `docs/api-reference.json` and `docs/llms-full.txt` from inspected Python objects. The MkDocs hook runs the same generator automatically; the explicit command is useful when reviewing generated changes before a build.

Commit authored pages, `mkdocs.yml`, the generator, and both generated LLM artifacts. Do not commit `site/`; it is build output.

## Source-of-truth rules

- Exact signatures and Python docstrings belong in source code and are rendered with mkdocstrings.
- Core guides describe backend-independent visualization and interchange workflows.
- Aurora backend guides own target construction, method behavior, and deployment details.
- Adapter deployment behavior remains owned by the adapter source and configuration.
- `api-reference.json` and `llms-full.txt` are generated; do not edit them manually.
- Run a strict build after changing exported symbols, signatures, docstrings, or navigation.
