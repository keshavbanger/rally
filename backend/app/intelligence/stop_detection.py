"""
Stop and Movement State Detection.

Architectural Note:
Stop and movement classification is centralized in `app.intelligence.movement`
via `classify_movement_state()`. This evaluates speed readings against the
configured stop threshold (STOP_SPEED_MPS) and maintains temporal hysteresis
to avoid flapping on brief pauses like traffic lights.
"""

from app.intelligence.movement import MovementResult, classify_movement_state

__all__ = ["classify_movement_state", "MovementResult"]
