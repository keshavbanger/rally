"""
Predictive Telemetry & ETA Estimation.

Architectural Note:
RALLY uses deterministic spatial-temporal kinematic models for trajectory
tracking and group ETA projection rather than black-box machine learning models:
- Group ETA calculation is centralized in `app.route.eta.EtaService`
- Movement progression is evaluated in `app.route.progress`
- Safety threshold adaptation is managed in `app.intelligence.thresholds`
"""

from app.route.eta import EtaService

__all__ = ["EtaService"]
