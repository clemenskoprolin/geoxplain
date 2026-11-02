"""Open an XAI result with a weather overlay using the thermal palette.

Run from the repository root with:
    uv run python examples/thermal_palette.py
"""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from geoxplain import GeoXplain
from geoxplain.overlay_result import load_overlay_result
from geoxplain.xia_result import load_xia_result


def main() -> None:
    examples_dir = Path(__file__).resolve().parent
    attribution = load_xia_result(examples_dir / "zurich.xia.npz")
    overlay = load_overlay_result(examples_dir / "zurich.overlay.npz")

    viewer = GeoXplain(title="Thermal palette preview", subtitle=None)
    viewer.add_attribution(attribution)
    viewer.add_overlay(
        overlay,
        colormap="thermal",
        visible=True,
        opacity=1.0,
    )

    with viewer.open() as handle:
        print(f"Open {handle.url} to preview the thermal palette")
        input("Press Enter to stop the local viewer server...")


if __name__ == "__main__":
    main()
