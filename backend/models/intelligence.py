from __future__ import annotations

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Dict, List, Optional


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
    signals: List[GeoSignal] = Field(default_factory=list)
    convergence_score: float = 0.0
    signal_types: List[str] = Field(default_factory=list)
    total_count: int = 0


class RegionalConvergence(BaseModel):
    region: str
    countries: List[str]
    convergence_score: float = 0.0
    active_signal_types: List[str] = Field(default_factory=list)


class NewsBulletin(BaseModel):
    id: str
    title: str
    summary: str = ""
    source: str = ""
    url: str = ""
    country_iso: str = ""
    signal_type: str = "diplomatic"
    lat: Optional[float] = None
    lon: Optional[float] = None
    published_at: datetime = Field(default_factory=datetime.utcnow)


class FocalPoint(BaseModel):
    entity_id: str
    entity_type: str
    focal_score: float = 0.0
    urgency: str = "watch"
    signal_types: List[str] = Field(default_factory=list)
    top_headlines: List[str] = Field(default_factory=list)
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
    countries: Dict[str, CountryScore] = Field(default_factory=dict)
    clusters: List[CountrySignalCluster] = Field(default_factory=list)
    regional: List[RegionalConvergence] = Field(default_factory=list)
    focal_points: List[FocalPoint] = Field(default_factory=list)
    signals: List[GeoSignal] = Field(default_factory=list)
    last_refresh: datetime = Field(default_factory=datetime.utcnow)
