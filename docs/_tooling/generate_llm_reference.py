"""Generate deterministic LLM-facing API references for the documentation.

The generator imports only each package's deliberately exported surface and a
small set of public result-loader classes. Heavy Aurora model dependencies are
loaded lazily by the adapter and are not initialized here.
"""

from __future__ import annotations

import importlib
import inspect
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
ADAPTER_ROOT = ROOT.parent / "geoxplain-aurora-adapter"
DOCS_DIR = ROOT / "docs"

if not (ADAPTER_ROOT / "geoxplain_aurora_adapter" / "__init__.py").is_file():
    raise SystemExit(
        "The shared docs require a sibling geoxplain-aurora-adapter checkout at "
        f"{ADAPTER_ROOT}"
    )

sys.path.insert(0, str(ADAPTER_ROOT))
sys.path.insert(0, str(ROOT))


def unload_package(package_name: str) -> None:
    """Remove cached modules so documentation always reflects checkout source."""

    for module_name in list(sys.modules):
        if module_name == package_name or module_name.startswith(f"{package_name}."):
            del sys.modules[module_name]


# MkDocs plugins may import an installed package before this hook runs. Reload
# both documented surfaces from the explicitly prepended checkout paths.
unload_package("geoxplain")
unload_package("geoxplain_aurora_adapter")


# Public methods intentionally shown to users and tool-using LLMs. Keeping this
# allowlist narrow prevents inherited anywidget/traitlets machinery from being
# mistaken for GeoXplain's API. Missing names fail generation loudly.
PUBLIC_MEMBERS: dict[str, list[str]] = {
    "geoxplain._base.GeoXplainBase": [
        "add_attribution",
        "clear_attributions",
        "add_overlay",
        "clear_overlays",
        "set_title",
        "set_subtitle",
        "set_options",
        "clear",
    ],
    "geoxplain.viewer.GeoXplain": [
        "export_path",
        "export",
        "export_browser",
        "remove_export",
        "screenshot",
        "open",
    ],
    "geoxplain.viewer.GeoXplainOpenHandle": ["close"],
    "geoxplain.widget.GeoXplainWidget": ["screenshot", "close"],
    "geoxplain.xia_result.XiaFrameProtocol": ["as_widget_dict"],
    "geoxplain.xia_result.XiaFrameFile": ["as_widget_dict"],
    "geoxplain_aurora_adapter.schema.spec.Target": ["point", "box"],
    "geoxplain_aurora_adapter.schema.spec.TargetSpec": [
        "point",
        "box",
        "box_bounds",
        "to_dict",
        "from_dict",
        "as_widget_dict",
    ],
    "geoxplain_aurora_adapter.schema.result.XiaFrame": ["as_widget_dict"],
    "geoxplain_aurora_adapter.schema.result.XiaResult": [
        "single",
        "save",
        "load",
        "to_msgpack",
        "from_msgpack",
        "summary",
    ],
    "geoxplain_aurora_adapter.schema.overlay.OverlayResult": [
        "timestamps",
        "arrays",
        "save",
        "load",
        "to_msgpack",
        "from_msgpack",
        "summary",
    ],
}


SUPPLEMENTAL_SYMBOLS = {
    "geoxplain": [
        "geoxplain.viewer.GeoXplainOpenHandle",
        "geoxplain.xia_result.XiaFrameProtocol",
        "geoxplain.xia_result.XiaFrameFile",
        "geoxplain.xia_result.XiaResultProtocol",
        "geoxplain.xia_result.XiaResultFile",
        "geoxplain.xia_result.load_xia_result",
        "geoxplain.overlay_result.OverlayFrameProtocol",
        "geoxplain.overlay_result.OverlayFrameFile",
        "geoxplain.overlay_result.OverlayResultProtocol",
        "geoxplain.overlay_result.OverlayResultFile",
        "geoxplain.overlay_result.load_overlay_result",
    ],
    "geoxplain_aurora_adapter": [],
}


def safe_signature(value: Any) -> str | None:
    try:
        signature = str(inspect.signature(value))
        return re.sub(r"<object object at 0x[0-9A-Fa-f]+>", "<object object>", signature)
    except (TypeError, ValueError):
        return None


def resolve(path: str) -> Any:
    module_name, _, attribute = path.rpartition(".")
    return getattr(importlib.import_module(module_name), attribute)


def describe_member(owner: type, name: str) -> dict[str, Any]:
    if not hasattr(owner, name):
        raise RuntimeError(f"Configured public member does not exist: {owner.__module__}.{owner.__qualname__}.{name}")

    descriptor = inspect.getattr_static(owner, name)
    value = getattr(owner, name)
    if isinstance(descriptor, property):
        kind = "property"
        documented_value = descriptor.fget
    elif isinstance(descriptor, classmethod):
        kind = "class method"
        documented_value = value
    elif isinstance(descriptor, staticmethod):
        kind = "static method"
        documented_value = value
    else:
        kind = "method"
        documented_value = value

    return {
        "name": name,
        "kind": kind,
        "signature": safe_signature(value),
        "description": inspect.getdoc(documented_value) or "",
    }


def describe_symbol(name: str, value: Any) -> dict[str, Any]:
    qualified_name = f"{value.__module__}.{value.__qualname__}"
    entry: dict[str, Any] = {
        "name": name,
        "qualified_name": qualified_name,
        "kind": "class" if inspect.isclass(value) else "function",
        "signature": safe_signature(value),
        "description": inspect.getdoc(value) or "",
    }
    if inspect.isclass(value):
        entry["members"] = [
            describe_member(value, member_name)
            for member_name in PUBLIC_MEMBERS.get(qualified_name, [])
        ]
    return entry


def package_symbols(package_name: str) -> list[tuple[str, Any]]:
    package = importlib.import_module(package_name)
    exported = [(name, getattr(package, name)) for name in package.__all__]
    supplemental = [
        (path.rsplit(".", 1)[-1], resolve(path))
        for path in SUPPLEMENTAL_SYMBOLS[package_name]
    ]

    seen: set[str] = set()
    result: list[tuple[str, Any]] = []
    for name, value in [*exported, *supplemental]:
        qualified_name = f"{value.__module__}.{value.__qualname__}"
        if qualified_name in seen:
            continue
        seen.add(qualified_name)
        result.append((name, value))
    return result


def build_inventory() -> dict[str, Any]:
    packages = []
    for package_name in ("geoxplain", "geoxplain_aurora_adapter"):
        packages.append(
            {
                "name": package_name,
                "symbols": [
                    describe_symbol(name, value)
                    for name, value in package_symbols(package_name)
                ],
            }
        )
    return {
        "schema_version": 1,
        "description": (
            "Public API inventory for the GeoXplain package and "
            "the separate Aurora backend package."
        ),
        "packages": packages,
    }


def render_full_reference(inventory: dict[str, Any]) -> str:
    lines = [
        "# GeoXplain core and backend API reference",
        "",
        "Generated from public Python exports. The `geoxplain` package is model-agnostic; backend-specific APIs are listed in separate package sections. Do not edit this file manually.",
        "",
    ]
    for package in inventory["packages"]:
        package_role = "Core package" if package["name"] == "geoxplain" else "Backend package"
        lines.extend([f"## {package_role} `{package['name']}`", ""])
        for symbol in package["symbols"]:
            signature = symbol["signature"] or ""
            lines.extend(
                [
                    f"### `{symbol['name']}{signature}`",
                    "",
                    f"Qualified name: `{symbol['qualified_name']}`. Kind: {symbol['kind']}.",
                    "",
                ]
            )
            if symbol["description"]:
                lines.extend([symbol["description"], ""])
            for member in symbol.get("members", []):
                member_signature = member["signature"] or ""
                lines.extend(
                    [
                        f"#### `{symbol['name']}.{member['name']}{member_signature}`",
                        "",
                        f"Kind: {member['kind']}.",
                        "",
                    ]
                )
                if member["description"]:
                    lines.extend([member["description"], ""])
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    inventory = build_inventory()
    (DOCS_DIR / "api-reference.json").write_text(
        json.dumps(inventory, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    (DOCS_DIR / "llms-full.txt").write_text(
        render_full_reference(inventory),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
