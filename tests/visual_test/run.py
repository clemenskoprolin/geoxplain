"""End-to-end orchestrator for the visual parity suite.

    python -m tests.visual_test            # full run (data -> refs -> screenshots -> images)
    python -m tests.visual_test --no-shots # skip the browser step (refs + data only)

Outputs land in ``tests/visual_test/output/``:
    reference_*.png, viewer_*.png, compare_*.png
"""

from __future__ import annotations

import argparse
import os
import sys

from geoxplain import GeoXplain

from . import capture, compose, reference
from .cases import CASES, DATA_LEVEL_HPA, kind_of
from .synthetic import to_viewer_array

HERE = os.path.dirname(__file__)
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT_DIR = os.path.join(HERE, "output")
VIEWER_DATA = os.path.join(REPO, "viewer", "public", "viewer_data.json")


def export_data() -> None:
    """Write all cases into viewer_data.json as separate exported methods."""
    v = GeoXplain(out_path=VIEWER_DATA)
    for case in CASES:
        v.add_attribution(
            to_viewer_array(case.field_v()),
            pressure_level=DATA_LEVEL_HPA,
            method=case.label,
            norm="global",
        )
    print(f"exported {len(CASES)} methods -> {VIEWER_DATA}")


def render_references() -> dict[str, str]:
    """Render one reference PNG per capture. Returns {capture_key: path}."""
    os.makedirs(OUT_DIR, exist_ok=True)
    paths: dict[str, str] = {}
    for case in CASES:
        field_v = case.field_v()
        for cap in case.captures:
            key = f"{case.slug}__{cap.suffix}"
            out = os.path.join(OUT_DIR, f"reference_{key}.png")
            title = case.label
            if cap.suffix != "main":
                title = f"{case.label} — {cap.suffix}"
            reference.render_reference(
                field_v,
                diverging=case.diverging,
                out_path=out,
                title=title,
                smooth_sigma=cap.ref_smooth_sigma,
            )
            paths[key] = out
            print(f"  reference {key}")
    return paths


def build_composites(ref_paths: dict[str, str], shot_paths: dict[str, str]) -> int:
    count = 0
    for case in CASES:
        for cap in case.captures:
            key = f"{case.slug}__{cap.suffix}"
            ref = ref_paths.get(key)
            shot = shot_paths.get(key)
            if not ref or not shot:
                continue
            composite = os.path.join(OUT_DIR, f"compare_{key}.png")
            title = case.label
            meta = f"aspect={case.aspect}  ·  mode={kind_of(case)}  ·  level={DATA_LEVEL_HPA} hPa"
            compose.compose_pair(
                ref, shot, composite,
                title=title,
                meta=meta,
                capture_caption=cap.caption or "default state",
                evaluate=case.evaluate,
            )
            count += 1
            print(f"  composite {key}")
    return count


def main() -> int:
    ap = argparse.ArgumentParser(description="GeoXplain Viewer visual parity suite")
    ap.add_argument("--no-shots", action="store_true",
                    help="skip the Playwright browser capture step")
    ap.add_argument("--settle-ms", type=int, default=capture.DEFAULT_SETTLE_MS,
                    help="milliseconds to wait before each screenshot")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)

    print("1/4  exporting synthetic debug data ...")
    export_data()

    print("2/4  rendering matplotlib references ...")
    ref_paths = render_references()

    shot_paths: dict[str, str] = {}
    if not args.no_shots:
        print("3/4  starting dev server + capturing viewer screenshots ...")
        proc = capture.start_dev_server()
        try:
            shot_paths = capture.capture_all(CASES, OUT_DIR, settle_ms=args.settle_ms)
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except Exception:
                proc.kill()
    else:
        print("3/4  skipping screenshots (--no-shots)")

    print("4/4  composing side-by-sides ...")
    comparisons = build_composites(ref_paths, shot_paths)
    print(f"\nDone. {comparisons} comparisons -> {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
