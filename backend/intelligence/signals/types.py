"""Signal types - migrated from WorldMonitor signal-aggregator.ts"""
from enum import Enum
from dataclasses import dataclass
from datetime import datetime
from typing import Optional


class SignalType(str, Enum):
    """Signal types from WorldMonitor"""
    INTERNET_OUTAGE = "internet_outage"
    MILITARY_FLIGHT = "military_flight"
    MILITARY_VESSEL = "military_vessel"
    PROTEST = "protest"
    AIS_DISRUPTION = "ais_disruption"
    SATELLITE_FIRE = "satellite_fire"
    RADIATION_ANOMALY = "radiation_anomaly"
    TEMPORAL_ANOMALY = "temporal_anomaly"
    SANCTIONS_PRESSURE = "sanctions_pressure"
    ACTIVE_STRIKE = "active_strike"


@dataclass
class GeoSignal:
    """Geographic signal"""
    type: SignalType
    country: str
    country_name: str
    lat: float
    lon: float
    severity: str  # low/medium/high
    title: str
    timestamp: datetime
    strike_count: Optional[int] = None
    high_severity_strike_count: Optional[int] = None
