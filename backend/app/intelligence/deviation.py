"""
Route Deviation Detection.

Architectural Note:
Route deviation evaluation is centralized in `app.route.progress` via
`classify_route_state()` and `app.route.service` to maintain a single source
of truth across route matching and live deviation alerting.
"""

from app.route.progress import classify_route_state

__all__ = ["classify_route_state"]
