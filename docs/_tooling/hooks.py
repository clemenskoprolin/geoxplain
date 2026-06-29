"""MkDocs hooks for generated documentation artifacts."""

from __future__ import annotations

import runpy
from pathlib import Path


def on_config(config):
    """Refresh the LLM-facing API inventory before MkDocs scans docs_dir."""

    root = Path(__file__).resolve().parents[2]
    runpy.run_path(
        str(root / "docs" / "_tooling" / "generate_llm_reference.py"),
        run_name="__main__",
    )
    return config
