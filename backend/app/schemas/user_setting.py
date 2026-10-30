import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class UserSettingBase(BaseModel):
    alert_sensitivity: Literal["LOW", "MEDIUM", "HIGH"] = "MEDIUM"
    separation_threshold_m: float = Field(default=150.0, ge=20.0, le=2000.0)
    route_deviation_threshold_m: float = Field(default=100.0, ge=20.0, le=2000.0)
    notifications_alerts: bool = True
    notifications_sos: bool = True
    notifications_connectivity: bool = True
    notifications_trip_summaries: bool = False
    sound_alerts_enabled: bool = True
    location_sharing: bool = True
    theme: Literal["dark", "light", "system"] = "dark"
    units: Literal["Metric", "Imperial"] = "Metric"


class UserSettingUpdate(BaseModel):
    alert_sensitivity: Optional[Literal["LOW", "MEDIUM", "HIGH"]] = None
    separation_threshold_m: Optional[float] = Field(default=None, ge=20.0, le=2000.0)
    route_deviation_threshold_m: Optional[float] = Field(default=None, ge=20.0, le=2000.0)
    notifications_alerts: Optional[bool] = None
    notifications_sos: Optional[bool] = None
    notifications_connectivity: Optional[bool] = None
    notifications_trip_summaries: Optional[bool] = None
    sound_alerts_enabled: Optional[bool] = None
    location_sharing: Optional[bool] = None
    theme: Optional[Literal["dark", "light", "system"]] = None
    units: Optional[Literal["Metric", "Imperial"]] = None


class UserSettingResponse(UserSettingBase):
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
