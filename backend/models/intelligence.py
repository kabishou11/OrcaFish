from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class ComponentScores(BaseModel):
    unrest: float = 0.0
    conflict: float = 0.0
    security: float = 0.0
    information: float = 0.0


class CountryScore(BaseModel):
    code: str  # ISO2
    name: str
    score: float = 0.0  # 0-100
    level: str = "low"  # low/normal/elevated/high/critical
    trend: str = "stable"  # rising/falling/stable
    change_24h: float = 0.0
    components: ComponentScores = ComponentScores()
    last_updated: datetime = Field(default_factory=datetime.utcnow)


class GeoSignal(BaseModel):
    signal_type: str  # internet_outage/military_flight/protest/ais_disruption...
    country_iso: str
    lat: float
    lon: float
    severity: str = "low"  # high/medium/low
    count: int = 1
    value: float = 0.0
    source: str = ""
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class CountrySignalCluster(BaseModel):
    country_iso: str
    signals: list[GeoSignal] = []
    convergence_score: float = 0.0
    signal_types: list[str] = []
    total_count: int = 0


class RegionalConvergence(BaseModel):
    region: str  # middle_east/east_asia/south_asia/eastern_europe/north_africa/sahel
    countries: list[str]
    convergence_score: float = 0.0
    active_signal_types: list[str] = []


class FocalPoint(BaseModel):
    entity_id: str
    entity_type: str  # country/company/commodity
    focal_score: float = 0.0
    urgency: str = "watch"  # watch/elevated/critical
    signal_types: list[str] = []
    top_headlines: list[str] = []
    narrative: str = ""


class ClusteredEvent(BaseModel):
    id: str
    primary_title: str
    source_count: int = 1
    threat: str = "low"
    lat: Optional[float] = None
    lon: Optional[float] = None
    velocity: float = 0.0


class IntelligenceState(BaseModel):
    countries: dict[str, CountryScore] = {}  # iso -> score
    clusters: list[CountrySignalCluster] = []
    regional: list[RegionalConvergence] = []
    focal_points: list[FocalPoint] = []
    signals: list[GeoSignal] = []
    last_refresh: datetime = Field(default_factory=datetime.utcnow)
