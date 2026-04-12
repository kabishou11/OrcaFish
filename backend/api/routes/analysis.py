from __future__ import annotations
"""OrcaFish Analysis API Routes — Multi-Agent Team Orchestration"""
import asyncio
import uuid
import re
from html import escape
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException

from backend.config import settings
from backend.models.analysis import (
    AnalysisAgentState,
    AnalysisRequest,
    AnalysisSectionState,
    AnalysisTask,
    AnalysisTimelineEvent,
)

router = APIRouter(prefix="/analysis", tags=["Analysis"])

# In-memory task registry
_task_registry: dict[str, AnalysisTask] = {}

_FAILURE_HINTS = (
    "遇到问题", "无数据", "暂无数据", "超时", "无法生成", "重新采集", "请问您希望",
    "我的立场", "没有数据", "未生成洞察", "未能成功采集", "数据收集遇到问题",
)

_AGENT_TITLES = {
    "query": "搜索研判流",
    "media": "媒体脉络流",
    "insight": "洞察结构流",
    "final": "综合结论流",
}

_AGENT_LABELS = {
    "query": "搜索代理体",
    "media": "媒体代理体",
    "insight": "洞察代理体",
    "report": "报告编排器",
}


def _extract_query_terms(query: str) -> list[str]:
    tokens = re.findall(r"[\u4e00-\u9fff]{2,8}|[A-Za-z][A-Za-z-]{2,}", query or "")
    seen: set[str] = set()
    result: list[str] = []
    for token in tokens:
        if token not in seen:
            seen.add(token)
            result.append(token)
    return result[:8]


def _looks_like_failure_text(text: str) -> bool:
    content = (text or "").strip()
    if not content:
        return True
    lowered = content.lower()
    return any(hint.lower() in lowered for hint in _FAILURE_HINTS)


def _build_fallback_news_digest(query: str) -> list[dict[str, str]]:
    from backend.intelligence.signal_aggregator import SignalAggregator

    aggregator = SignalAggregator()
    try:
        aggregator.poll_external_sources()
    except Exception:
        pass

    items = aggregator.get_news_items(limit=12)
    terms = _extract_query_terms(query)
    matched = []
    for item in items:
        haystack = f"{item.title} {item.summary} {item.country_iso}".lower()
        if any(term.lower() in haystack for term in terms):
            matched.append(item)
    picked = matched[:6] if matched else items[:6]
    return [
        {
            "title": item.title,
            "summary": item.summary or "监控引擎已捕获相关动态，正文仍在补全。",
            "source": item.source or "OrcaFish Monitor",
            "country": item.country_iso or "GLOBAL",
            "published_at": item.published_at.strftime("%Y-%m-%d %H:%M"),
            "signal_type": item.signal_type,
        }
        for item in picked
    ]


def _build_sentiment_hint(text: str) -> dict[str, int]:
    positive_words = ["缓和", "合作", "谈判", "停火", "稳定", "修复", "降温"]
    negative_words = ["升级", "冲突", "制裁", "攻击", "威胁", "危机", "对抗", "紧张"]
    uncertain_words = ["可能", "观察", "不确定", "摇摆", "博弈", "待定"]

    def count(words: list[str]) -> int:
        return sum(len(re.findall(word, text or "")) for word in words)

    return {
        "positive": count(positive_words),
        "negative": count(negative_words),
        "uncertain": count(uncertain_words),
    }


def _strip_md(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").replace("#", "").replace(">", "")).strip()

def _build_initial_sections(query: str, matched_terms: list[str]) -> list[AnalysisSectionState]:
    term_hint = "、".join(matched_terms[:4]) or query
    return [
        AnalysisSectionState(
            key="query",
            title=_AGENT_TITLES["query"],
            order=1,
            status="queued",
            summary=f"正在锁定“{term_hint}”相关公开线索与事实触发点。",
        ),
        AnalysisSectionState(
            key="media",
            title=_AGENT_TITLES["media"],
            order=2,
            status="queued",
            summary="等待正文与媒体标题回流，用于重建事件叙事脉络。",
        ),
        AnalysisSectionState(
            key="insight",
            title=_AGENT_TITLES["insight"],
            order=3,
            status="queued",
            summary="等待情绪、立场与关注点结构输出。",
        ),
        AnalysisSectionState(
            key="final",
            title=_AGENT_TITLES["final"],
            order=4,
            status="queued",
            summary="等待三路结果汇总后生成综合结论。",
        ),
    ]


def _build_initial_agent_metrics() -> dict[str, AnalysisAgentState]:
    metrics: dict[str, AnalysisAgentState] = {}
    for key in ("query", "media", "insight", "report"):
        metrics[key] = AnalysisAgentState(
            key=key,
            label=_AGENT_LABELS[key],
            status="queued",
            progress=0,
            summary="等待启动。",
        )
    return metrics


def _build_sections(
    query: str,
    results: dict[str, str],
    final_report: str,
    fallback_map: dict[str, bool],
    source_count: int,
    current_status: str,
) -> list[AnalysisSectionState]:
    sections: list[AnalysisSectionState] = []
    for order, key in enumerate(("query", "media", "insight"), start=1):
        content = (results.get(key) or "").strip()
        section_status = "fallback" if fallback_map.get(key) else "done" if content else "running" if current_status in {"running", "assembling"} else "queued"
        sections.append(
            AnalysisSectionState(
                key=key,
                title=_AGENT_TITLES[key],
                order=order,
                status=section_status,
                summary=_strip_md(content)[:160] if content else f"{_AGENT_LABELS[key]}正在补齐“{query}”相关素材。",
                content=content,
                source_count=source_count if content else 0,
                fallback_used=bool(fallback_map.get(key)),
                updated_at=datetime.now(UTC),
            )
        )

    final_status = "degraded" if current_status == "degraded" else "done" if final_report else "running" if current_status in {"assembling", "running"} else "queued"
    sections.append(
        AnalysisSectionState(
            key="final",
            title=_AGENT_TITLES["final"],
            order=4,
            status=final_status,
            summary=_strip_md(final_report)[:180] if final_report else "综合结论仍在整理三路结果与监控底稿。",
            content=final_report or "",
            source_count=source_count if final_report else 0,
            fallback_used=current_status == "degraded",
            updated_at=datetime.now(UTC),
        )
    )
    return sections


def _make_timeline_event(stage: str, title: str, detail: str, status: str) -> AnalysisTimelineEvent:
    return AnalysisTimelineEvent(
        key=f"{stage}-{uuid.uuid4().hex[:8]}",
        stage=stage,
        title=title,
        detail=detail,
        status=status,
    )


def _append_timeline(task: AnalysisTask, event: AnalysisTimelineEvent) -> None:
    existing = list(task.timeline)
    existing.append(event)
    task.timeline = existing[-18:]


def _append_agent_start_events(task: AnalysisTask) -> None:
    for key, detail in (
        ("query", "搜索代理正在抓取公开报道、事件线索与事实片段。"),
        ("media", "媒体代理正在整理标题、正文和报道脉络。"),
        ("insight", "洞察代理正在识别情绪走向、分歧点与立场结构。"),
    ):
        _append_timeline(
            task,
            _make_timeline_event(
                key,
                f"{_AGENT_LABELS[key]}开始工作",
                detail,
                "running",
            ),
        )


def _export_model(model: object) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump()  # type: ignore[no-any-return]
    if hasattr(model, "dict"):
        return model.dict()  # type: ignore[no-any-return]
    return dict(model) if isinstance(model, dict) else {}


def _update_task_snapshot(task: AnalysisTask, results: dict[str, str], news_digest: list[dict[str, str]], fallback_map: dict[str, bool], status: str, progress: int, final_report: str = "") -> None:
    task.status = status
    task.progress = progress
    task.news_digest = news_digest
    task.source_count = len(news_digest)
    task.fallback_used = any(fallback_map.values())
    task.matched_terms = _extract_query_terms(task.query)
    task.sentiment_hint = _build_sentiment_hint(" ".join([task.query, *results.values(), final_report]))
    task.sections = _build_sections(task.query, results, final_report, fallback_map, len(news_digest), status)
    task.agent_status = {
        "query": "fallback" if fallback_map.get("query") else ("done" if results.get("query") else "waiting"),
        "media": "fallback" if fallback_map.get("media") else ("done" if results.get("media") else "waiting"),
        "insight": "fallback" if fallback_map.get("insight") else ("done" if results.get("insight") else "waiting"),
        "report": status,
    }
    agent_metrics = task.agent_metrics or _build_initial_agent_metrics()
    for key in ("query", "media", "insight"):
        has_content = bool(results.get(key))
        agent_metrics[key] = AnalysisAgentState(
            key=key,
            label=_AGENT_LABELS[key],
            status="fallback" if fallback_map.get(key) else "done" if has_content else "running" if status in {"running", "assembling"} else "queued",
            progress=100 if has_content else min(progress, 80) if status in {"running", "assembling"} else 0,
            source_count=len(news_digest) if has_content else 0,
            summary=_strip_md(results.get(key, ""))[:120] if has_content else f"{_AGENT_LABELS[key]}正在处理“{task.query}”。",
            fallback_used=bool(fallback_map.get(key)),
            updated_at=datetime.now(UTC),
        )
    agent_metrics["report"] = AnalysisAgentState(
        key="report",
        label=_AGENT_LABELS["report"],
        status="done" if final_report and status in {"completed", "degraded"} else "running" if final_report or status == "assembling" else "queued",
        progress=100 if final_report and status in {"completed", "degraded"} else 68 if status == "assembling" else min(progress, 40),
        source_count=len(news_digest) if final_report else 0,
        summary=_strip_md(final_report)[:120] if final_report else "等待三路结果收口后输出综合报告。",
        fallback_used=status == "degraded",
        updated_at=datetime.now(UTC),
    )
    task.agent_metrics = agent_metrics
    if status == "degraded":
        task.degraded_reason = "当前拿到的是监控新闻与结构化底稿，真实素材不足，不能视为完整研判。"
        task.ui_message = "当前为降级底稿，可继续观察、补数或进入预测预演。"
    elif status == "completed":
        task.degraded_reason = None
        task.ui_message = "三路结果已汇总完成，可以继续进入未来推演。"
    else:
        task.ui_message = "多代理正在并行研判，结果会按板块陆续到达。"
    if final_report:
        task.final_report = final_report
    task.last_update_at = datetime.now(UTC)


def _build_agent_fallback_report(query: str, agent_key: str, news_digest: list[dict[str, str]]) -> str:
    lead = {
        "query": "搜索代理体已经切换到监控新闻与公开信号摘要，以下是当前可用的事实线索。",
        "media": "媒体代理体未拿到完整正文时，会先基于新闻标题与摘要重建叙事脉络。",
        "insight": "洞察代理体未拿到完整社媒数据时，会先根据热点标题、地区和信号类型给出观察框架。",
    }[agent_key]
    section_title = {
        "query": "搜索流摘要",
        "media": "媒体脉络摘要",
        "insight": "洞察结构摘要",
    }[agent_key]

    if not news_digest:
        return f"## {section_title}\n\n围绕“{query}”尚未收集到足够公开素材，系统已切换到结构化框架模式，建议继续观察后续新闻和信号变化。"

    bullets = []
    for item in news_digest[:4]:
        bullets.append(
            f"- [{item['country']}] {item['title']}（{item['source']}，{item['published_at']}）\n"
            f"  {item['summary'][:140]}"
        )

    if agent_key == "query":
        closing = "可先据此确认主要地区、事件触发点与外部政策动作。"
    elif agent_key == "media":
        closing = "从这些标题与摘要看，报道已形成“事件触发—升级信号—外部回应”的叙事链。"
    else:
        closing = "当前最值得继续追踪的是情绪是否继续升温、讨论是否从新闻转向行动预期。"

    return f"## {section_title}\n\n{lead}\n\n" + "\n".join(bullets) + f"\n\n{closing}"


def _build_fallback_final_report(query: str, results: dict[str, str], news_digest: list[dict[str, str]]) -> str:
    lines = [
        f"# {query} — 议题综合研判",
        "",
        f"> 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## 当前判断",
        f"围绕“{query}”的公开线索仍在持续变化。当前报告优先整合监控新闻、热点地区与信号类型，给出一个可以直接进入未来预测的工作底稿，而不是输出空白或失败说明。",
        "",
    ]

    for key, title in (("query", "搜索流"), ("media", "媒体流"), ("insight", "洞察流")):
        content = results.get(key, "").strip()
        if content:
            lines.append(f"## {title}")
            lines.append(content)
            lines.append("")

    if news_digest:
        lines.append("## 监控新闻摘录")
        for item in news_digest[:5]:
            lines.append(f"- {item['title']}（{item['country']} · {item['source']}）")
        lines.append("")

    lines.extend([
        "## 下一步建议",
        "1. 继续观察监控新闻是否集中指向同一地区与同一触发事件。",
        "2. 将当前综合底稿送入未来预测，观察参与方、平台与行动链路如何展开。",
        "3. 如果后续正文抓取恢复，再用新增素材回填搜索流与媒体流。",
    ])
    return "\n".join(lines)


def _derive_highlights(query: str, news_digest: list[dict[str, str]], results: dict[str, str]) -> list[str]:
    highlights: list[str] = []
    seen: set[str] = set()
    for item in news_digest[:4]:
        headline = item.get("title", "").strip()
        if headline and headline not in seen:
            highlights.append(headline)
            seen.add(headline)
    for key in ("query", "media", "insight"):
        summary = _strip_md(results.get(key, ""))[:120]
        if summary and summary not in seen:
            highlights.append(summary)
            seen.add(summary)
    if not highlights:
        highlights.append(f"围绕“{query}”的公开线索仍在补齐。")
    return highlights[:5]


def _build_structured_final_report(query: str, results: dict[str, str], news_digest: list[dict[str, str]], fallback_map: dict[str, bool]) -> str:
    highlights = _derive_highlights(query, news_digest, results)
    fallback_total = sum(1 for used in fallback_map.values() if used)
    status_note = "当前报告包含监控底稿与结构化补全内容。" if fallback_total else "当前报告基于三路真实素材汇总。"
    lines = [
        f"# {query} — 议题综合研判",
        "",
        f"> 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  ",
        f"> 研判状态：{status_note}",
        "",
        "## 一页结论",
    ]
    for item in highlights[:3]:
        lines.append(f"- {item}")
    lines.extend(["", "## 分路结果"])
    for key, title in (("query", "搜索研判流"), ("media", "媒体脉络流"), ("insight", "洞察结构流")):
        content = (results.get(key) or "").strip()
        lines.append(f"### {title}")
        lines.append(content or "该板块仍在等待更多素材。")
        lines.append("")
    if news_digest:
        lines.append("## 监控底稿")
        for item in news_digest[:5]:
            lines.append(f"- {item['title']}（{item['country']} · {item['source']} · {item['published_at']}）")
        lines.append("")
    lines.extend([
        "## 下一步行动",
        "1. 检查当前板块中哪些仍是监控底稿，优先补齐那些影响判断的关键素材。",
        "2. 如需预演趋势，可将当前综合结论送入未来推演，观察参与方与行动链路。",
        "3. 持续追踪新闻与地区信号变化，确认风险是否继续升温或转入缓和。",
    ])
    return "\n".join(lines)


def _render_fallback_html(query: str, merged_markdown: str, news_digest: list[dict[str, str]]) -> str:
    content_html = merged_markdown.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    content_html = content_html.replace("\n", "<br/>")
    news_html = "".join(
        (
            "<div class='news-item'>"
            f"<div class='news-title'>{escape(item['title'])}</div>"
            f"<div class='news-meta'>{escape(item['country'])} · {escape(item['source'])} · {escape(item['published_at'])}</div>"
            f"<div class='news-summary'>{escape(item['summary'])}</div>"
            "</div>"
        )
        for item in news_digest[:5]
    )
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
body {{ font-family: 'IBM Plex Sans', -apple-system, sans-serif; margin: 0; background: #f7fbff; color: #16324f; }}
.shell {{ max-width: 980px; margin: 24px auto; background: rgba(255,255,255,0.96); border: 1px solid #d9e7f3; border-radius: 24px; overflow: hidden; box-shadow: 0 24px 60px rgba(15,23,42,0.08); }}
.hero {{ padding: 28px 32px; background: linear-gradient(135deg, rgba(37,99,235,0.12), rgba(14,165,233,0.08), rgba(22,163,74,0.06)); border-bottom: 1px solid #d9e7f3; }}
.hero h1 {{ margin: 0 0 8px; font-size: 1.9rem; color: #102a56; }}
.hero p {{ margin: 0; color: #48617c; line-height: 1.7; }}
.content {{ padding: 28px 32px 36px; display: grid; gap: 20px; }}
.card {{ background: #fff; border: 1px solid #e3edf6; border-radius: 18px; padding: 18px 20px; }}
.card h2 {{ margin: 0 0 10px; font-size: 1.05rem; color: #163b75; }}
.report {{ white-space: pre-wrap; line-height: 1.8; color: #243b53; font-size: 0.92rem; }}
.news-item {{ padding: 10px 0; border-top: 1px solid #eef4fa; }}
.news-item:first-child {{ border-top: none; padding-top: 0; }}
.news-title {{ font-weight: 700; color: #102a56; margin-bottom: 4px; }}
.news-meta {{ font-size: 0.72rem; color: #6b7f93; margin-bottom: 6px; }}
.news-summary {{ font-size: 0.84rem; color: #40586f; line-height: 1.7; }}
</style>
</head>
<body>
<div class="shell">
  <div class="hero">
    <h1>议题研判报告：{escape(query)}</h1>
    <p>当前外部抓取链路不足时，系统会退回到“监控新闻 + 信号摘要 + 结构化分析”模式，保证你拿到的是可继续工作的报告，而不是失败说明。</p>
  </div>
  <div class="content">
    <div class="card">
      <h2>综合研判</h2>
      <div class="report">{content_html}</div>
    </div>
    <div class="card">
      <h2>监控新闻底稿</h2>
      {news_html or "<div class='news-summary'>当前暂无可展示的监控新闻。</div>"}
    </div>
  </div>
</div>
</body>
</html>"""

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
        reasoning_split=settings.query_llm.reasoning_split,
    )
    media_llm = LLMClient(
        api_key=settings.media_llm.api_key,
        base_url=settings.media_llm.base_url,
        model=settings.media_llm.model,
        provider=settings.media_llm.provider,
        reasoning_split=settings.media_llm.reasoning_split,
    )
    insight_llm = LLMClient(
        api_key=settings.insight_llm.api_key,
        base_url=settings.insight_llm.base_url,
        model=settings.insight_llm.model,
        provider=settings.insight_llm.provider,
        reasoning_split=settings.insight_llm.reasoning_split,
    )
    report_llm = LLMClient(
        api_key=settings.report_llm.api_key,
        base_url=settings.report_llm.base_url,
        model=settings.report_llm.model,
        provider=settings.report_llm.provider,
        reasoning_split=settings.report_llm.reasoning_split,
    )

    if task:
        task.progress = 5
        task.status = "running"
        task.last_update_at = datetime.now(UTC)
        _append_timeline(task, _make_timeline_event("bootstrap", "已启动议题研判", f"已为“{query}”创建并行任务，正在分配搜索、媒体与洞察代理体。", "running"))

    # ── Agent instantiation ────────────────────────────────────────────
    agents = {
        "query":   QueryAgent(query_llm),
        "media":   MediaAgent(media_llm),
        "insight": InsightAgent(insight_llm),
    }

    if task:
        task.progress = 10
        task.agent_metrics = {
            **task.agent_metrics,
            "query": AnalysisAgentState(key="query", label=_AGENT_LABELS["query"], status="running", progress=15, summary="正在抓取公开线索。", updated_at=datetime.now(UTC)),
            "media": AnalysisAgentState(key="media", label=_AGENT_LABELS["media"], status="running", progress=15, summary="正在整理标题与正文脉络。", updated_at=datetime.now(UTC)),
            "insight": AnalysisAgentState(key="insight", label=_AGENT_LABELS["insight"], status="running", progress=15, summary="正在分析情绪与立场结构。", updated_at=datetime.now(UTC)),
        }
        _append_agent_start_events(task)

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

    news_digest = _build_fallback_news_digest(query)
    if task:
        first_headline = news_digest[0]["title"] if news_digest else "正在等待外部信息。"
        _append_timeline(
            task,
            _make_timeline_event(
                "digest",
                "监控底稿已接入",
                f"当前已接入 {len(news_digest)} 条监控新闻摘要，最新线索：{first_headline}",
                "done" if news_digest else "running",
            ),
        )
        task.ui_message = f"已接入 {len(news_digest)} 条监控摘要，多代理正在并行研判。"
    results: dict[str, str] = {}
    fallback_map: dict[str, bool] = {"query": False, "media": False, "insight": False}
    agent_jobs = [
        asyncio.create_task(run_query()),
        asyncio.create_task(run_media()),
        asyncio.create_task(run_insight()),
    ]
    completed = 0

    for future in asyncio.as_completed(agent_jobs):
        try:
            key, report = await future
            if _looks_like_failure_text(report):
                fallback_map[key] = True
                report = _build_agent_fallback_report(query, key, news_digest)
            results[key] = report
        except Exception:
            continue

        completed += 1
        if task:
            if key == "query":
                task.query_report = results[key]
            elif key == "media":
                task.media_report = results[key]
            elif key == "insight":
                task.insight_report = results[key]
            _append_timeline(
                task,
                _make_timeline_event(
                    key,
                    f"{_AGENT_LABELS[key]}已返回",
                    (
                        f"当前板块使用监控底稿作为临时输出，已复用 {len(news_digest)} 条摘要补齐。"
                        if fallback_map.get(key)
                        else _strip_md(results[key])[:150] or f"{_AGENT_LABELS[key]}已完成输出。"
                    ),
                    "fallback" if fallback_map.get(key) else "done",
                ),
            )
            _update_task_snapshot(
                task,
                results=results,
                news_digest=news_digest,
                fallback_map=fallback_map,
                status="running",
                progress=min(20 + completed * 18, 78),
            )

    # ── Stage 2: Merge agent outputs ───────────────────────────────────
    merged = _merge_agent_reports(
        query=query,
        query_report=results.get("query", ""),
        media_report=results.get("media", ""),
        insight_report=results.get("insight", ""),
    )
    if _looks_like_failure_text(merged):
        merged = _build_fallback_final_report(query, results, news_digest)
    else:
        merged = _build_structured_final_report(query, results, news_digest, fallback_map)
    if task:
        _append_timeline(task, _make_timeline_event("report", "正在编排综合结论", "三路结果已经汇总，正在去重并生成结构化综合报告。", "running"))
        _update_task_snapshot(
            task,
            results=results,
            news_digest=news_digest,
            fallback_map=fallback_map,
            status="assembling",
            progress=86,
            final_report=merged,
        )

    # ── Stage 3: Generate final HTML report ───────────────────────────
    report_agent = ReportAgent(report_llm)
    if task:
        _append_timeline(
            task,
            _make_timeline_event(
                "render",
                "正在整理报告版式",
                "结构化结论已完成，正在渲染最终报告版面与可视化摘要。",
                "running",
            ),
        )
    try:
        html = await asyncio.wait_for(
            report_agent.generate(
                task_id=task_id,
                query=query,
                query_report=results.get("query", ""),
                media_report=results.get("media", ""),
                insight_report=results.get("insight", ""),
            ),
            timeout=300.0,
        )
        if _looks_like_failure_text(html):
            html = _render_fallback_html(query, merged, news_digest)
        if task:
            task.html_report = html
    except asyncio.TimeoutError:
        if task:
            task.html_report = _render_fallback_html(query, merged, news_digest)
    except Exception as e:
        if task:
            task.html_report = _render_fallback_html(query, f"{merged}\n\n[报告生成器异常：{str(e)}]", news_digest)

    if task:
        fallback_total = sum(1 for used in fallback_map.values() if used)
        task.data_quality = "degraded" if fallback_total >= 3 else "mixed" if fallback_total > 0 else "live"
        task.progress = 100 if fallback_total == 0 else 96 if fallback_total < 3 else 88
        task.status = "degraded" if fallback_total >= 2 else "completed"
        task.sections = _build_sections(query, results, merged, fallback_map, len(news_digest), task.status)
        task.agent_status = {
            "query": "fallback" if fallback_map.get("query") else "done",
            "media": "fallback" if fallback_map.get("media") else "done",
            "insight": "fallback" if fallback_map.get("insight") else "done",
            "report": "done",
        }
        task.fallback_used = any(fallback_map.values())
        task.source_count = len(news_digest)
        task.news_digest = news_digest
        task.matched_terms = _extract_query_terms(query)
        task.sentiment_hint = _build_sentiment_hint(" ".join([query, *results.values(), merged]))
        task.degraded_reason = "至少两路代理体未拿到足够真实素材，当前输出主要依赖监控底稿。" if task.status == "degraded" else None
        task.ui_message = "当前为降级底稿，建议继续补齐素材后再作为正式研判使用。" if task.status == "degraded" else "综合研判已完成，可继续进入未来推演。"
        task.agent_metrics = {
            "query": AnalysisAgentState(key="query", label=_AGENT_LABELS["query"], status="fallback" if fallback_map.get("query") else "done", progress=100, source_count=len(news_digest), summary=_strip_md(results.get("query", ""))[:120], fallback_used=bool(fallback_map.get("query")), updated_at=datetime.now(UTC)),
            "media": AnalysisAgentState(key="media", label=_AGENT_LABELS["media"], status="fallback" if fallback_map.get("media") else "done", progress=100, source_count=len(news_digest), summary=_strip_md(results.get("media", ""))[:120], fallback_used=bool(fallback_map.get("media")), updated_at=datetime.now(UTC)),
            "insight": AnalysisAgentState(key="insight", label=_AGENT_LABELS["insight"], status="fallback" if fallback_map.get("insight") else "done", progress=100, source_count=len(news_digest), summary=_strip_md(results.get("insight", ""))[:120], fallback_used=bool(fallback_map.get("insight")), updated_at=datetime.now(UTC)),
            "report": AnalysisAgentState(key="report", label=_AGENT_LABELS["report"], status="done", progress=100, source_count=len(news_digest), summary=_strip_md(merged)[:120], fallback_used=task.status == "degraded", updated_at=datetime.now(UTC)),
        }
        _append_timeline(
            task,
            _make_timeline_event(
                "final",
                "综合报告已生成",
                task.ui_message or "综合报告已生成。",
                "warning" if task.status == "degraded" else "done",
            ),
        )
        if task.html_report:
            _append_timeline(
                task,
                _make_timeline_event(
                    "html",
                    "报告版面已可阅读",
                    "综合报告区已完成排版，可以继续审阅重点结论或送入未来预测。",
                    "done",
                ),
            )
        task.last_update_at = datetime.now(UTC)
        task.completed_at = datetime.now(UTC)
    return results


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
    sections = []
    seen_summaries: set[str] = set()

    for title, content in (
        ("社交媒体舆情分析", insight_report),
        ("媒体报道与多媒体分析", media_report),
        ("深度网络舆情研究", query_report),
    ):
        normalized = _strip_md(content)
        if not normalized:
            continue
        fingerprint = normalized[:160]
        if fingerprint in seen_summaries:
            continue
        seen_summaries.add(fingerprint)
        sections.append(f"## {title}\n\n{content.strip()}")

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
        progress=3,
        agent_status={"query": "queued", "media": "queued", "insight": "queued", "report": "queued"},
        agent_metrics=_build_initial_agent_metrics(),
        matched_terms=_extract_query_terms(req.query),
        sections=_build_initial_sections(req.query, _extract_query_terms(req.query)),
        timeline=[
            _make_timeline_event(
                "queued",
                "议题已进入队列",
                f"“{req.query}”已提交，系统正在准备多代理并行研判。",
                "queued",
            )
        ],
        ui_message="议题已提交，结果会按搜索、媒体、洞察、综合四段陆续到达。",
        last_update_at=datetime.now(UTC),
    )
    _task_registry[task_id] = task

    asyncio.create_task(_run_agent_team(task_id, req.query))

    return {
        "task_id": task_id,
        "status": "running",
        "query": req.query,
        "data_quality": "unknown",
        "progress": task.progress,
        "agent_status": task.agent_status,
        "agent_metrics": {key: _export_model(value) for key, value in task.agent_metrics.items()},
        "sections": [_export_model(section) for section in task.sections],
        "timeline": [_export_model(event) for event in task.timeline],
        "ui_message": task.ui_message,
        "last_update_at": task.last_update_at.isoformat() if task.last_update_at else None,
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
        "query": task.query,
        "status": task.status,
        "progress": task.progress,
        "data_quality": task.data_quality,
        "degraded_reason": task.degraded_reason,
        "ui_message": task.ui_message,
        "fallback_used": task.fallback_used,
        "source_count": task.source_count,
        "matched_terms": task.matched_terms,
        "sentiment_hint": task.sentiment_hint,
        "news_digest": task.news_digest,
        "agent_status": task.agent_status,
        "agent_metrics": {key: _export_model(value) for key, value in (task.agent_metrics or {}).items()},
        "sections": [_export_model(section) for section in task.sections],
        "timeline": [_export_model(event) for event in task.timeline],
        "last_update_at": task.last_update_at.isoformat() if task.last_update_at else None,
        "query_report": task.query_report,
        "media_report": task.media_report,
        "insight_report": task.insight_report,
        "final_report": task.final_report,
        "html_report": task.html_report,
        "error": task.error,
    }
