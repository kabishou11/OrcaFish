"""OrcaFish Analysis Module — BettaFish engines integrated.

Exports
-------
Agents:
    DeepSearchAgent  : abstract base (search → summarise → reflect pipeline)
    QueryAgent      : internet news via Tavily Search API
    MediaAgent      : multimodal content via Bocha Search API
    InsightAgent    : social-media /舆情 via MindSpider database

Report:
    ReportAgent      : assembles multi-engine reports into styled HTML

State models:
    AgentState       : full research session
    Paragraph        : one report chapter
    SearchResult     : one search hit
"""

from backend.analysis.agents.base import (
    DeepSearchAgent,
    AgentState,
    Paragraph,
    SearchResult,
)
from backend.analysis.agents.query import QueryAgent
from backend.analysis.agents.media import MediaAgent
from backend.analysis.agents.insight import InsightAgent
from backend.analysis.report.agent import ReportAgent, ReportTask

__all__ = [
    # Base
    "DeepSearchAgent",
    "AgentState",
    "Paragraph",
    "SearchResult",
    # Engines
    "QueryAgent",
    "MediaAgent",
    "InsightAgent",
    # Assembler
    "ReportAgent",
    "ReportTask",
]
