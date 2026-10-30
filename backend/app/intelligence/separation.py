"""
Group Separation and Dispersion Detection.

Architectural Note:
Separation and isolation detectors are centralized in `app.intelligence.detectors`
to share spatial clustering calculations and debounce state:
- `detect_group_separation`
- `detect_falling_behind`
- `detect_isolated_members`
"""

from app.intelligence.detectors import (
    detect_falling_behind,
    detect_group_separation,
    detect_isolated_members,
)

__all__ = [
    "detect_group_separation",
    "detect_falling_behind",
    "detect_isolated_members",
]
