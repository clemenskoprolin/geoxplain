"""Vertical-layer id helpers shared by the exporter and viewer base.

Layer keys are decoupled from Aurora's pressure levels: an atmospheric layer
is ``"z-{N}"`` where the integer ``N`` is a vertical order (higher renders
higher); surface fields use the reserved key ``"sfc"`` (always sorts lowest).
"""

import re

_SFC_LEVEL_ID = 'sfc'
_LEVEL_RE = re.compile(r'^z-(-?\d+)$')
# Finite, JSON-safe order sentinel that sorts ``sfc`` below every ``z-N``.
_SFC_ORDER = -1_000_000


def is_valid_level_id(level_id: str) -> bool:
    """True for the reserved ``"sfc"`` key or a ``"z-<int>"`` layer key."""
    return level_id == _SFC_LEVEL_ID or bool(_LEVEL_RE.match(level_id))


def level_order(level_id: str) -> int:
    """Vertical sort key — higher renders higher; ``sfc`` sorts lowest."""
    if level_id == _SFC_LEVEL_ID:
        return _SFC_ORDER
    m = _LEVEL_RE.match(level_id)
    return int(m.group(1)) if m else _SFC_ORDER


def default_layer_label(level_id: str) -> str:
    """Display label when ``layer_labels`` has no entry for *level_id*."""
    if level_id == _SFC_LEVEL_ID:
        return 'Surface'
    m = _LEVEL_RE.match(level_id)
    return m.group(1) if m else level_id
