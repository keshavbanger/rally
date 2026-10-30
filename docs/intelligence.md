# RALLY — Intelligence & Safety Engine Specification

## 1. Engine Philosophy: Deterministic & Explainable

RALLY rejects non-deterministic, black-box machine learning in life-critical convoy safety. Instead, the platform relies on **deterministic, spatial-temporal physics, vector geometry, and temporal hysteresis**.

Key Principles:
1. **Explainability**: Every alert clearly describes the underlying measurement (e.g. `Distance: 240m > Threshold: 150m for 45s`).
2. **Zero-Latency Execution**: Calculations execute in micro-seconds in-memory without GPU dependencies.
3. **Flap Prevention**: Hysteresis timers prevent false alarms from temporary traffic pauses.

---

## 2. Core Detectors (`app/intelligence/detectors.py`)

### 2.1 Movement Classification (`movement.py`)
Classifies each member into one of three states:
- `MOVING`: Speed $> 1.0\text{ m/s}$ (configurable via `STOP_SPEED_MPS`).
- `STOPPED`: Speed $\le 1.0\text{ m/s}$ sustained for $\ge 60\text{ seconds}$ (`STOP_DURATION_SECONDS`).
- `STALE`: Telemetry timestamp $> 45\text{ seconds}$ old (`STALE_LOCATION_SECONDS`).

### 2.2 Falling Behind Detector (`detect_falling_behind`)
- **Trigger**: A member's distance from the group centroid exceeds `falling_behind_distance_meters` ($150\text{m} \times 0.6 = 90\text{m}$) while their movement speed is less than the group's median forward velocity for $\ge 30\text{ seconds}$.
- **Severity**: `WARNING`.

### 2.3 Isolated Member Detector (`detect_isolated_members`)
- **Trigger**: Distance from the nearest fellow member exceeds `isolated_member_distance_meters` ($150\text{m} \times 1.25 = 187.5\text{m}$) for $\ge 45\text{ seconds}$.
- **Severity**: `CRITICAL`.

### 2.4 Group Separation Detector (`detect_group_separation`)
- **Trigger**: Maximum pairwise distance among members exceeds `group_separation_distance_meters` ($150\text{m}$) for $\ge 30\text{ seconds}$.
- **Severity**: `WARNING` or `CRITICAL` if dispersion $> 300\text{m}$.

### 2.5 Route Deviation Detector (`app/route/progress.py`)
- **Trigger**: Perpendicular distance from planned route polyline exceeds `off_route_threshold_meters` ($100\text{m}$) using Shapely spatial projection for $\ge 30\text{ seconds}$.
- **Severity**: `WARNING`.

---

## 3. Dynamic Threshold Adaptation (`thresholds.py`)

Thresholds adapt according to the trip leader's configured `alert_sensitivity`:
- **`HIGH` Sensitivity**:
  - Buffer factor: $0.8$ (alerts trigger sooner).
  - Stop detection threshold: $30\text{ seconds}$.
- **`MEDIUM` Sensitivity** (Default):
  - Buffer factor: $1.0$.
  - Stop detection threshold: $60\text{ seconds}$.
- **`LOW` Sensitivity**:
  - Buffer factor: $1.3$ (tolerates wider dispersion on open highways).
  - Stop detection threshold: $120\text{ seconds}$.

---

## 4. Group Health Telemetry Formulation

The dashboard computes a deterministic composite Group Health Index ($0 - 100$):

$$\text{Group Health} = \min\left(100, \max\left(0, 0.3 \cdot T + 0.3 \cdot R + 0.2 \cdot C + 0.2 \cdot S\right)\right)$$

Where:
- **Togetherness ($T$)**: Percentage of located members within safe separation buffer ($150\text{m}$).
- **On-Route ($R$)**: Percentage of members adhering to the planned corridor.
- **Connectivity ($C$)**: Ratio of connected online members to total group roster.
- **Stability ($S$)**: $100 - (10 \cdot \text{Warnings} + 25 \cdot \text{Critical Alerts} + 40 \cdot \text{Active SOS})$.

If no GPS data or route is configured, the metric explicitly reports `INSUFFICIENT_DATA` rather than fabricating an artificially healthy score.
