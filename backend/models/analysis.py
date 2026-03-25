"""OrcaFish Analysis Models — Pydantic schemas for the analysis module."""
from datetime import datetime
from typing import Optional, List
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

    def mark_assembling(self):
        self.status = "assembling"

    def mark_completed(self):
        self.status = "completed"
        self.progress = 100
        self.completed_at = datetime.utcnow()

    def mark_failed(self, error: str):
        self.status = "failed"
        self.error = error
