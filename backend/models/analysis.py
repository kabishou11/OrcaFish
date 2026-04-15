"""OrcaFish Analysis Models — Pydantic schemas for the analysis module."""
from datetime import UTC, datetime
from typing import Optional, List, Dict, Literal
from pydantic import BaseModel, Field


class AnalysisRequest(BaseModel):
    """
    Incoming request to run multi-engine analysis.
    Sent by the frontend / API layer.
    """

    query: str = Field(..., description="Research topic / question")
    include_query: bool = Field(
        True, description="Run QueryAgent (internet news via Tavily)"
    )
    include_media: bool = Field(
        True, description="Run MediaAgent (multimedia via Bocha)"
    )
    include_insight: bool = Field(
        False, description="Run InsightAgent (social media via MindSpider DB)"
    )


class ParagraphSummary(BaseModel):
    """A single paragraph/chapter in the report."""

    title: str
    content: str = ""
    order: int = 0
    word_count: Optional[int] = None


class AnalysisReport(BaseModel):
    """Markdown report from a single engine."""

    engine: str = Field(..., description="Engine name: query | media | insight")
    report_title: str
    paragraphs: List[ParagraphSummary] = Field(default_factory=list)
    full_markdown: str = ""
    sources_count: int = 0


class AnalysisSectionState(BaseModel):
    """Structured section state for stepwise rendering."""

    key: str
    title: str
    order: int
    status: Literal["queued", "running", "done", "fallback", "degraded"] = "queued"
    summary: str = ""
    content: str = ""
    source_count: int = 0
    fallback_used: bool = False
    updated_at: Optional[datetime] = None


class AnalysisTimelineEvent(BaseModel):
    """One event in the analysis timeline."""

    key: str
    stage: str
    title: str
    detail: str
    status: Literal["queued", "running", "done", "fallback", "warning", "failed"] = "queued"
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class AnalysisAgentState(BaseModel):
    """Per-agent structured progress."""

    key: str
    label: str
    status: Literal["queued", "running", "done", "fallback", "failed"] = "queued"
    progress: int = 0
    source_count: int = 0
    summary: str = ""
    fallback_used: bool = False
    updated_at: Optional[datetime] = None


class AnalysisTask(BaseModel):
    """
    Full analysis task state.
    Tracks progress across all three engines and the final assembly.
    """

    task_id: str
    query: str
    status: str = Field(
        default="pending",
        description="pending | running | assembling | completed | failed",
    )
    progress: int = Field(
        default=0, ge=0, le=100, description="Overall completion percentage"
    )
    data_quality: str = Field(
        default="unknown",
        description="unknown | live | mixed | degraded",
    )
    degraded_reason: Optional[str] = None
    ui_message: Optional[str] = None
    fallback_used: bool = Field(default=False)
    source_count: int = 0
    matched_terms: List[str] = Field(default_factory=list)
    sentiment_hint: Dict[str, int] = Field(default_factory=dict)
    news_digest: List[dict] = Field(default_factory=list)
    graph_id: Optional[str] = None
    graph_source_mode: Optional[str] = None
    graph_queries: List[str] = Field(default_factory=list)
    graph_facts: List[str] = Field(default_factory=list)
    graph_edges: List[dict] = Field(default_factory=list)
    graph_nodes: List[dict] = Field(default_factory=list)
    agent_status: Dict[str, str] = Field(default_factory=dict)
    agent_metrics: Dict[str, AnalysisAgentState] = Field(default_factory=dict)
    sections: List[AnalysisSectionState] = Field(default_factory=list)
    timeline: List[AnalysisTimelineEvent] = Field(default_factory=list)
    last_update_at: Optional[datetime] = None
    query_report: Optional[str] = Field(
        default=None, description="Markdown from QueryAgent"
    )
    media_report: Optional[str] = Field(
        default=None, description="Markdown from MediaAgent"
    )
    insight_report: Optional[str] = Field(
        default=None, description="Markdown from InsightAgent"
    )
    final_report: Optional[str] = Field(
        default=None, description="Assembled markdown report"
    )
    html_report: Optional[str] = Field(
        default=None, description="Rendered HTML report"
    )
    error: Optional[str] = Field(default=None, description="Error message if failed")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = Field(default=None)

    def mark_running(self):
        self.status = "running"
        self.last_update_at = datetime.now(UTC)

    def mark_assembling(self):
        self.status = "assembling"
        self.last_update_at = datetime.now(UTC)

    def mark_completed(self):
        self.status = "completed"
        self.progress = 100
        self.completed_at = datetime.now(UTC)
        self.last_update_at = self.completed_at

    def mark_failed(self, error: str):
        self.status = "failed"
        self.error = error
        self.last_update_at = datetime.now(UTC)
