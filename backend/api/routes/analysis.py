from __future__ import annotations
"""OrcaFish Analysis API Routes — Multi-Agent Team Orchestration"""
import uuid
import asyncio
from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from backend.models.analysis import AnalysisTask
from backend.config import settings

router = APIRouter(prefix="/analysis", tags=["Analysis"])

# In-memory task registry
_task_registry: dict[str, AnalysisTask] = {}


class AnalysisRequest(BaseModel):
    query: str


# ── Agent Team ──────────────────────────────────────────────────────────────
async def _run_agent_team(task_id: str, query: str) -> dict[str, str]:
    """
    Orchestrate three agents in parallel (Insight + Media + Query),
    then merge their outputs into a combined report for ReportAgent.

    Agent team strategy:
      - InsightAgent  : social-media sentiment & trending analysis  (MindSpider DB)
      - MediaAgent   : multimodal news & image analysis             (Bocha Search)
      - QueryAgent    : deep web search & factual research          (Tavily Search)

    All three run concurrently via asyncio.gather().
    Their outputs are merged and passed to ReportAgent for the final HTML.
    """
    from backend.llm.client import LLMClient
    from backend.analysis.agents.query import QueryAgent
    from backend.analysis.agents.insight import InsightAgent
    from backend.analysis.agents.media import MediaAgent
    from backend.analysis.report.agent import ReportAgent

    task = _task_registry.get(task_id)
    if not task:
        return {}

    # ── LLM clients (one per agent role) ────────────────────────────────
    query_llm = LLMClient(
        api_key=settings.query_llm.api_key,
        base_url=settings.query_llm.base_url,
        model=settings.query_llm.model,
        provider=settings.query_llm.provider,
    )
    media_llm = LLMClient(
        api_key=settings.media_llm.api_key,
        base_url=settings.media_llm.base_url,
        model=settings.media_llm.model,
        provider=settings.media_llm.provider,
    )
    insight_llm = LLMClient(
        api_key=settings.insight_llm.api_key,
        base_url=settings.insight_llm.base_url,
        model=settings.insight_llm.model,
        provider=settings.insight_llm.provider,
    )
    report_llm = LLMClient(
        api_key=settings.report_llm.api_key,
        base_url=settings.report_llm.base_url,
        model=settings.report_llm.model,
        provider=settings.report_llm.provider,
    )

    # ── Progress: Initializing agents ──────────────────────────────────
    if task:
        task.progress = 5
        task.status = "running"

    # ── Agent instantiation ────────────────────────────────────────────
    agents = {
        "query":   QueryAgent(query_llm),
        "media":   MediaAgent(media_llm),
        "insight": InsightAgent(insight_llm),
    }

    # ── Stage 1: Parallel agent research ───────────────────────────────
    if task:
        task.progress = 10

    # Run all three agents concurrently
    # Each has its own LLM and search tool — no shared state
    async def run_query() -> tuple[str, str]:
        try:
            state = await asyncio.wait_for(
                agents["query"].research(query),
                timeout=240.0,
            )
            return ("query", state.final_report or f"{query} 深度研究报告（网络搜索）")
        except asyncio.TimeoutError:
            return ("query", f"关于 {query} 的网络舆情搜索（超时）")
        except Exception:
            return ("query", f"{query} 网络搜索遇到问题。")

    async def run_media() -> tuple[str, str]:
        try:
            state = await asyncio.wait_for(
                agents["media"].research(query),
                timeout=240.0,
            )
            return ("media", state.final_report or f"{query} 多媒体舆情分析（媒体报道）")
        except asyncio.TimeoutError:
            return ("media", f"关于 {query} 的媒体报道分析（超时）")
        except Exception:
            return ("media", f"{query} 媒体报道分析遇到问题。")

    async def run_insight() -> tuple[str, str]:
        try:
            state = await asyncio.wait_for(
                agents["insight"].research(query),
                timeout=240.0,
            )
            return ("insight", state.final_report or f"{query} 社交媒体舆情分析（社媒数据）")
        except asyncio.TimeoutError:
            return ("insight", f"关于 {query} 的社交媒体分析（超时）")
        except Exception:
            return ("insight", f"{query} 社交媒体分析遇到问题。")

    # Launch all three in parallel — results merged regardless of individual failures
    results: dict[str, str] = {}
    agent_tasks = await asyncio.gather(run_query(), run_media(), run_insight(), return_exceptions=True)

    for result in agent_tasks:
        if isinstance(result, Exception):
            # Log and continue — other agents may have succeeded
            continue
        key, report = result
        results[key] = report

    if task:
        task.progress = 60

    # ── Stage 2: Merge agent outputs ───────────────────────────────────
    merged = _merge_agent_reports(
        query=query,
        query_report=results.get("query", ""),
        media_report=results.get("media", ""),
        insight_report=results.get("insight", ""),
    )
    task.query_report = merged
    task.progress = 70

    # ── Stage 3: Generate final HTML report ───────────────────────────
    report_agent = ReportAgent(report_llm)
    try:
        html = await asyncio.wait_for(
            report_agent.generate(
                task_id=task_id,
                query=query,
                query_report=merged,
            ),
            timeout=300.0,
        )
        task.html_report = html
    except asyncio.TimeoutError:
        task.html_report = f"<div class='report-body'><h1>关于 {query} 的舆情分析报告</h1><p>报告生成超时，请稍后重试。</p><pre>{merged[:2000]}</pre></div>"
    except Exception as e:
        task.html_report = f"<div class='report-body'><h1>关于 {query} 的舆情分析报告</h1><p>报告生成出错：{str(e)}</p><pre>{merged[:2000]}</pre></div>"

    task.progress = 100
    task.status = "completed"


def _merge_agent_reports(
    query: str,
    query_report: str,
    media_report: str,
    insight_report: str,
) -> str:
    """
    Merge the three agent outputs into a single structured markdown report.
    Uses the Report LLM to synthesize a coherent narrative.
    """
    # Build a structured merge using the LLM
    # We do a simple concatenation here — ReportAgent.reports will do the synthesis
    sections = []

    if insight_report and insight_report.strip():
        sections.append(
            f"## 社交媒体舆情分析\n\n{insight_report.strip()}"
        )
    if media_report and media_report.strip():
        sections.append(
            f"## 媒体报道与多媒体分析\n\n{media_report.strip()}"
        )
    if query_report and query_report.strip():
        sections.append(
            f"## 深度网络舆情研究\n\n{query_report.strip()}"
        )

    if not sections:
        return f"# 关于 {query} 的舆情分析报告\n\n暂无数据。"

    return (
        f"# {query} — 舆情综合分析报告\n\n"
        f"> 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        + "\n\n".join(sections)
        + f"\n\n---\n\n*本报告由 OrcaFish 多智能体团队（舆情搜索 × 媒体报道 × 社交媒体）自动生成。*"
    )


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/trigger")
async def trigger_analysis(req: AnalysisRequest) -> dict:
    """Trigger a multi-agent舆情 analysis (runs Insight + Media + Query in parallel)"""
    task_id = f"task_{uuid.uuid4().hex[:12]}"
    task = AnalysisTask(
        task_id=task_id,
        query=req.query,
        status="running",
        progress=0,
    )
    _task_registry[task_id] = task

    asyncio.create_task(_run_agent_team(task_id, req.query))

    return {
        "task_id": task_id,
        "status": "running",
        "query": req.query,
        "message": "多智能体分析已提交，Query + Media + Insight 并行运行中，请通过 /api/analysis/{task_id} 查询结果",
    }


@router.get("/{task_id}")
async def get_analysis_task(task_id: str) -> dict:
    """Get analysis task status and results"""
    task = _task_registry.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {
        "task_id": task.task_id,
        "status": task.status,
        "progress": task.progress,
        "query_report": task.query_report,
        "html_report": task.html_report,
        "error": task.error,
    }
