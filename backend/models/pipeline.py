"""OrcaFish Pipeline Models"""
from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class PipelineStage(str):
    DETECTED = "detected"
    ANALYSIS = "analysis"
    SIMULATION = "simulation"
    COMPLETED = "completed"
    FAILED = "failed"


class TriggerEvent(BaseModel):
    country_iso: str
    country_name: str
    location_name: str = ""
    lat: float = 0.0
    lon: float = 0.0
    cii_score: float = 0.0
    triggered_by: list[str] = Field(default_factory=list)
    signal_types: list[str] = Field(default_factory=list)
    signal_details: dict = Field(default_factory=dict)


class PipelineState(BaseModel):
    pipeline_id: str
    country_iso: str
    country_name: str
    lat: float = 0.0
    lon: float = 0.0
    cii_score: float = 0.0
    triggered_by: list[str] = Field(default_factory=list)
    signal_types: list[str] = Field(default_factory=list)
    stage: str = PipelineStage.DETECTED
    stage_progress: int = 0
    analysis_task_id: Optional[str] = None
    analysis_html: Optional[str] = None
    analysis_markdown: Optional[str] = None
    simulation_project_id: Optional[str] = None
    simulation_id: Optional[str] = None
    prediction_markdown: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime = datetime.utcnow()
    updated_at: datetime = datetime.utcnow()
    completed_at: Optional[datetime] = None


class PipelineEvent(BaseModel):
    event_type: str
    pipeline_id: str
    data: dict = Field(default_factory=dict)
    timestamp: datetime = datetime.utcnow()
