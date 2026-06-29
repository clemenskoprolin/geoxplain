"""Compose reference|viewer side-by-side panels."""

from __future__ import annotations

import textwrap

from PIL import Image, ImageDraw, ImageFont
from matplotlib import font_manager

_FONT_PATH = font_manager.findfont("DejaVu Sans")
_FONT_BOLD = font_manager.findfont(font_manager.FontProperties(weight="bold"))

PAD = 14
PANEL_W = 760           # each side is scaled to this width
BANNER_BG = (28, 32, 38)
SUB_BG = (44, 50, 58)
FOOT_BG = (240, 242, 245)
WHITE = (255, 255, 255)
DARK = (30, 34, 40)


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(_FONT_BOLD if bold else _FONT_PATH, size)


def _scaled(img: Image.Image, width: int) -> Image.Image:
    h = round(img.height * width / img.width)
    return img.resize((width, h), Image.LANCZOS)


def _text_block(draw, xy, lines, font, fill, line_h):
    x, y = xy
    for ln in lines:
        draw.text((x, y), ln, font=font, fill=fill)
        y += line_h
    return y


# Center crop applied to the live-viewer screenshot before scaling.
#
# The viewer auto-zooms to the data bounds (AttributionViewer line ~317), which
# always maps the *padded* data span to ~512 CSS px centred in the viewport.
# In the 1100x820 capture the field therefore sits dead-centre and occupies a
# known sub-rectangle; cropping to it enlarges the field to roughly match the
# reference panel's scale, and clears the top method-tabs and the left
# pressure-level panel. Tuned for VIEWPORT=1100x820, EUROPE_EXTENT data bounds.
VIEWER_CROP = (340, 195, 760, 625)  # (left, top, right, bottom)


def compose_pair(
    ref_path: str,
    viewer_path: str,
    out_path: str,
    *,
    title: str,
    meta: str,
    capture_caption: str,
    evaluate: str,
) -> None:
    ref = _scaled(Image.open(ref_path).convert("RGB"), PANEL_W)
    viewer_full = Image.open(viewer_path).convert("RGB")
    viewer_cropped = viewer_full.crop(VIEWER_CROP)
    viewer = _scaled(viewer_cropped, PANEL_W)
    panel_h = max(ref.height, viewer.height)

    banner_h = 64
    sub_h = 30
    # Wrap the evaluation text for the footer.
    foot_font = _font(15)
    wrapped = textwrap.wrap("EVALUATE: " + evaluate, width=150)
    foot_h = PAD * 2 + len(wrapped) * 21

    total_w = PANEL_W * 2 + PAD * 3
    total_h = banner_h + sub_h + panel_h + foot_h + PAD * 2

    canvas = Image.new("RGB", (total_w, total_h), WHITE)
    draw = ImageDraw.Draw(canvas)

    # Banner.
    draw.rectangle([0, 0, total_w, banner_h], fill=BANNER_BG)
    draw.text((PAD, 10), title, font=_font(22, bold=True), fill=WHITE)
    draw.text((PAD, 40), meta, font=_font(14), fill=(170, 178, 190))

    # Sub-banner (per-side labels).
    y = banner_h
    draw.rectangle([0, y, total_w, y + sub_h], fill=SUB_BG)
    draw.text((PAD, y + 7), "LEFT — matplotlib reference (ground truth)",
              font=_font(14, bold=True), fill=(150, 210, 160))
    draw.text((PANEL_W + PAD * 2, y + 7),
              f"RIGHT — live viewer  ·  {capture_caption}",
              font=_font(14, bold=True), fill=(150, 190, 230))

    # Panels.
    y += sub_h + PAD
    canvas.paste(ref, (PAD, y))
    canvas.paste(viewer, (PANEL_W + PAD * 2, y))

    # Footer with evaluation guidance.
    fy = y + panel_h + PAD
    draw.rectangle([0, fy, total_w, total_h], fill=FOOT_BG)
    _text_block(draw, (PAD, fy + PAD), wrapped, foot_font, DARK, 21)

    canvas.save(out_path)
