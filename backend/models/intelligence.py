from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class ComponentScores(BaseModel):
    unrest: float = 0.0
    conflict: float = 0.0
    security: float = 0.0
    information: float = 0.0


class CountryScore(BaseModel):
    code: str
    name: str
    score: float = 0.0
    level: str = "low"
    trend: str = "stable"
    change_24h: float = 0.0
    components: ComponentScores = ComponentScores()
    last_updated: datetime = Field(default_factory=datetime.utcnow)


class GeoSignal(BaseModel):
    signal_type: str
    country_iso: str
    lat: float
    lon: float
    severity: str = "low"
    count: int = 1
    value: float = 0.0
    source: str = ""
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class CountrySignalCluster(BaseModel):
    country_iso: str
    signals: list[GeoSignal] = Field(default_factory=list)
    convergence_score: float = 0.0
    signal_types: list[str] = Field(default_factory=list)
    total_count: int = 0


class RegionalConvergence(BaseModel):
    region: str
    countries: list[str]
    convergence_score: float = 0.0
    active_signal_types: list[str] = Field(default_factory=list)


class FocalPoint(BaseModel):
    entity_id: str
    entity_type: str
    focal_score: float = 0.0
    urgency: str = "watch"
    signal_types: list[str] = Field(default_factory=list)
    top_headlines: list[str] = Field(default_factory=list)
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
    countries: dict[str, CountryScore] = Field(default_factory=dict)
    clusters: list[CountrySignalCluster] = Field(default_factory=list)
    regional: list[RegionalConvergence] = Field(default_factory=list)
    focal_points: list[FocalPoint] = Field(default_factory=list)
    signals: list[GeoSignal] = Field(default_factory=list)
    last_refresh: datetime = Field(default_factory=datetime.utcnow)
