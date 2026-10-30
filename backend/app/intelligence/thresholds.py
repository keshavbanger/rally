"""
Typed snapshot of every intelligence threshold, read from app.core.config
once per evaluation instead of scattering `settings.X` references through
detectors.py/engine.py/group_analysis.py callers. Also makes thresholds
trivial for tests to override (monkeypatch `settings.X`, same established
pattern as the rest of this codebase) without reaching into every function
signature.
"""

from dataclasses import dataclass

from app.core.config import settings as _settings


@dataclass(frozen=True)
class Thresholds:
    stop_speed_mps: float
    stop_duration_seconds: int
    stale_location_seconds: int
    falling_behind_distance_meters: float
    falling_behind_duration_seconds: int
    group_separation_distance_meters: float
    group_separation_duration_seconds: int
    isolated_member_distance_meters: float
    isolated_member_duration_seconds: int
    max_reasonable_speed_mps: float
    speed_anomaly_duration_seconds: int
    group_cohesion_distance_meters: float
    min_usable_accuracy_meters: float
    evaluation_interval_seconds: float
    # --- Route intelligence (Phase 9) ---
    route_endpoint_tolerance_meters: float
    off_route_threshold_meters: float
    route_deviation_duration_seconds: int
    arrival_threshold_meters: float
    arrival_duration_seconds: int
    route_progress_stale_seconds: int
    baseline_route_speed_mps: float


from typing import Any, Optional


def current_thresholds(user_setting: Optional[Any] = None) -> Thresholds:
    """Reads the live `settings` object on every call, and incorporates
    any configured user safety thresholds and alert sensitivity."""
    s = _settings
    base = Thresholds(
        stop_speed_mps=s.STOP_SPEED_MPS,
        stop_duration_seconds=s.STOP_DURATION_SECONDS,
        stale_location_seconds=s.STALE_LOCATION_SECONDS,
        falling_behind_distance_meters=s.FALLING_BEHIND_DISTANCE_METERS,
        falling_behind_duration_seconds=s.FALLING_BEHIND_DURATION_SECONDS,
        group_separation_distance_meters=s.GROUP_SEPARATION_DISTANCE_METERS,
        group_separation_duration_seconds=s.GROUP_SEPARATION_DURATION_SECONDS,
        isolated_member_distance_meters=s.ISOLATED_MEMBER_DISTANCE_METERS,
        isolated_member_duration_seconds=s.ISOLATED_MEMBER_DURATION_SECONDS,
        max_reasonable_speed_mps=s.MAX_REASONABLE_SPEED_MPS,
        speed_anomaly_duration_seconds=s.SPEED_ANOMALY_DURATION_SECONDS,
        group_cohesion_distance_meters=s.GROUP_COHESION_DISTANCE_METERS,
        min_usable_accuracy_meters=s.MIN_USABLE_ACCURACY_METERS,
        evaluation_interval_seconds=s.INTELLIGENCE_EVALUATION_INTERVAL_SECONDS,
        route_endpoint_tolerance_meters=s.ROUTE_ENDPOINT_TOLERANCE_METERS,
        off_route_threshold_meters=s.OFF_ROUTE_THRESHOLD_METERS,
        route_deviation_duration_seconds=s.ROUTE_DEVIATION_DURATION_SECONDS,
        arrival_threshold_meters=s.ARRIVAL_THRESHOLD_METERS,
        arrival_duration_seconds=s.ARRIVAL_DURATION_SECONDS,
        route_progress_stale_seconds=s.ROUTE_PROGRESS_STALE_SECONDS,
        baseline_route_speed_mps=s.BASELINE_ROUTE_SPEED_MPS,
    )
    if not user_setting:
        return base

    sep_m = getattr(user_setting, "separation_threshold_m", None) or base.group_separation_distance_meters
    dev_m = getattr(user_setting, "route_deviation_threshold_m", None) or base.off_route_threshold_meters
    sensitivity = (getattr(user_setting, "alert_sensitivity", "MEDIUM") or "MEDIUM").upper()

    if sensitivity == "HIGH":
        factor = 0.8
        stop_dur = max(20, int(base.stop_duration_seconds * 0.75))
    elif sensitivity == "LOW":
        factor = 1.3
        stop_dur = int(base.stop_duration_seconds * 1.5)
    else:
        factor = 1.0
        stop_dur = base.stop_duration_seconds

    return Thresholds(
        stop_speed_mps=base.stop_speed_mps,
        stop_duration_seconds=stop_dur,
        stale_location_seconds=base.stale_location_seconds,
        falling_behind_distance_meters=sep_m * 0.6 * factor,
        falling_behind_duration_seconds=max(5, int(base.falling_behind_duration_seconds * factor)),
        group_separation_distance_meters=sep_m * factor,
        group_separation_duration_seconds=max(5, int(base.group_separation_duration_seconds * factor)),
        isolated_member_distance_meters=sep_m * 1.25 * factor,
        isolated_member_duration_seconds=max(5, int(base.isolated_member_duration_seconds * factor)),
        max_reasonable_speed_mps=base.max_reasonable_speed_mps,
        speed_anomaly_duration_seconds=base.speed_anomaly_duration_seconds,
        group_cohesion_distance_meters=sep_m * 0.5 * factor,
        min_usable_accuracy_meters=base.min_usable_accuracy_meters,
        evaluation_interval_seconds=base.evaluation_interval_seconds,
        route_endpoint_tolerance_meters=base.route_endpoint_tolerance_meters,
        off_route_threshold_meters=dev_m * factor,
        route_deviation_duration_seconds=max(5, int(base.route_deviation_duration_seconds * factor)),
        arrival_threshold_meters=base.arrival_threshold_meters,
        arrival_duration_seconds=base.arrival_duration_seconds,
        route_progress_stale_seconds=base.route_progress_stale_seconds,
        baseline_route_speed_mps=base.baseline_route_speed_mps,
    )

