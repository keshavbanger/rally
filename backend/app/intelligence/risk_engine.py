"""
Risk Scoring Engine.

Architectural Note:
Trip risk assessment is centralized in `app.risk.service` via `calculate_trip_risk()`.
Risk scoring is a deterministic, rule-based aggregation of active alerts, active SOS
events, telemetry gaps, and weather conditions, producing an explainable 0–100 score
and level (LOW, MEDIUM, HIGH, CRITICAL).
"""

from app.risk.service import calculate_trip_risk

__all__ = ["calculate_trip_risk"]
