from __future__ import annotations
"""OrcaFish Analysis API Routes — Multi-Agent Team Orchestration"""
import asyncio
import json
import os
import uuid
import re
from html import escape
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException

from backend.analysis.agents.base import extract_source_facts
from backend.config import settings
from backend.graph import GraphBuilder as KnowledgeGraphBuilder, ZepTools
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

_ANALYSIS_GRAPH_TOOLS = ZepTools()
_ANALYSIS_LLM_TIMEOUT_SECONDS = 30
_ANALYSIS_LLM_MAX_RETRIES = 1


def _analysis_tasks_dir() -> str:
    return os.path.join(os.path.dirname(__file__), "..", "..", "data", "analysis_tasks")


def _analysis_task_path(task_id: str) -> str:
    return os.path.join(_analysis_tasks_dir(), f"{task_id}.json")


def _persist_analysis_task(task: AnalysisTask) -> None:
    os.makedirs(_analysis_tasks_dir(), exist_ok=True)
    with open(_analysis_task_path(task.task_id), "w", encoding="utf-8") as f:
        json.dump(task.model_dump(mode="json"), f, ensure_ascii=False, indent=2)


def _load_analysis_task(task_id: str) -> AnalysisTask | None:
    path = _analysis_task_path(task_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
        task = AnalysisTask.model_validate(payload)
    except Exception:
        return None
    _task_registry[task_id] = task
    return task


def _get_task(task_id: str) -> AnalysisTask | None:
    return _task_registry.get(task_id) or _load_analysis_task(task_id)


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


def _safe_extract_source_facts(state: object, limit: int = 4) -> list[dict[str, str]]:
    if not hasattr(state, "paragraphs"):
        return []
    try:
        return extract_source_facts(state, limit=limit)
    except Exception:
        return []


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


def _coerce_int(value: object) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _normalize_source_fact(fact: dict[str, str]) -> dict[str, str]:
    return {
        "title": str(fact.get("title") or "未命名来源").strip() or "未命名来源",
        "source": str(fact.get("source") or "外部来源").strip() or "外部来源",
        "url": str(fact.get("url") or "").strip(),
        "summary": str(fact.get("summary") or "").strip(),
        "paragraph_title": str(fact.get("paragraph_title") or "").strip(),
        "published_at": str(fact.get("published_at") or "").strip(),
    }


def _build_digest_source_facts(news_digest: list[dict[str, str]]) -> list[dict[str, str]]:
    return [
        _normalize_source_fact(
            {
                "title": item.get("title", ""),
                "source": item.get("source", "OrcaFish Monitor"),
                "summary": item.get("summary", ""),
                "paragraph_title": item.get("country", "监控摘要"),
                "published_at": item.get("published_at", ""),
            }
        )
        for item in news_digest
        if item.get("title")
    ]


def _merge_source_facts(
    agent_facts: dict[str, list[dict[str, str]]],
    news_digest: list[dict[str, str]],
    limit: int = 12,
) -> list[dict[str, str]]:
    merged: list[dict[str, str]] = []
    seen: set[str] = set()
    for fact in [*sum(agent_facts.values(), []), *_build_digest_source_facts(news_digest)]:
        normalized = _normalize_source_fact(fact)
        identity = normalized["url"] or f"{normalized['source']}::{normalized['title']}"
        if not identity or identity in seen:
            continue
        seen.add(identity)
        merged.append(normalized)
        if len(merged) >= limit:
            break
    return merged


def _build_graph_calibration(query: str, news_digest: list[dict[str, str]], source_facts: list[dict[str, str]]) -> dict[str, object]:
    text_chunks: list[str] = []
    if query.strip():
        text_chunks.append(query.strip())
    for fact in source_facts[:8]:
        line = " ".join(
            part for part in [
                str(fact.get("title") or "").strip(),
                str(fact.get("summary") or "").strip(),
                str(fact.get("paragraph_title") or "").strip(),
            ]
            if part
        ).strip()
        if line:
            text_chunks.append(line)
    for item in news_digest[:8]:
        line = " ".join(
            part for part in [
                str(item.get("title") or "").strip(),
                str(item.get("summary") or "").strip(),
                str(item.get("country") or "").strip(),
                str(item.get("signal_type") or "").strip(),
            ]
            if part
        ).strip()
        if line:
            text_chunks.append(line)

    deduped_chunks: list[str] = []
    seen_chunks: set[str] = set()
    for chunk in text_chunks:
        normalized = chunk.strip()
        if normalized and normalized not in seen_chunks:
            seen_chunks.add(normalized)
            deduped_chunks.append(normalized)

    if not deduped_chunks:
        return {
            "graph_id": None,
            "graph_source_mode": "no_graph",
            "graph_queries": [],
            "graph_facts": [],
            "graph_edges": [],
            "graph_nodes": [],
        }

    builder = KnowledgeGraphBuilder()
    graph_id = builder.create_graph(f"analysis::{query[:24] or 'topic'}")
    episode_ids = builder.add_text_batch(graph_id, deduped_chunks[:12])
    builder.wait_for_processing(episode_ids)

    query_candidates = [query.strip(), *_extract_query_terms(query)]
    search_queries: list[str] = []
    seen_queries: set[str] = set()
    for item in query_candidates:
        normalized = str(item or "").strip()
        if normalized and normalized not in seen_queries:
            seen_queries.add(normalized)
            search_queries.append(normalized)

    facts: list[str] = []
    edges: list[dict[str, object]] = []
    nodes: list[dict[str, object]] = []
    source_mode = "graph_unavailable"
    for graph_query in search_queries[:4]:
        result = _ANALYSIS_GRAPH_TOOLS.search_graph(graph_id=graph_id, query=graph_query, limit=4, scope="both")
        source_mode = result.source_mode or source_mode
        for fact in result.facts:
            if fact and fact not in facts:
                facts.append(fact)
        for edge in result.edges:
            edge_uuid = str(edge.get("uuid") or "")
            if edge_uuid and not any(str(item.get("uuid") or "") == edge_uuid for item in edges):
                edges.append(edge)
        for node in result.nodes:
            node_uuid = str(node.get("uuid") or "")
            if node_uuid and not any(str(item.get("uuid") or "") == node_uuid for item in nodes):
                nodes.append(node)

    return {
        "graph_id": graph_id,
        "graph_source_mode": source_mode,
        "graph_queries": search_queries[:4],
        "graph_facts": facts[:8],
        "graph_edges": edges[:6],
        "graph_nodes": nodes[:6],
    }


def _format_source_fact_lines(source_facts: list[dict[str, str]], limit: int = 6) -> list[str]:
    lines: list[str] = []
    for fact in source_facts[:limit]:
        meta_parts = [
            part for part in [
                fact.get("source", ""),
                fact.get("published_at", ""),
                fact.get("paragraph_title", ""),
            ] if part
        ]
        line = f"- {fact.get('title', '未命名来源')}（{' · '.join(meta_parts) or '外部来源'}）"
        summary = (fact.get("summary") or "").strip()
        if summary:
            line += f"\n  {summary[:180]}"
        url = (fact.get("url") or "").strip()
        if url:
            line += f"\n  链接：{url}"
        lines.append(line)
    return lines

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
    source_counts: dict[str, int],
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
                source_count=source_counts.get(key, 0) if content else 0,
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
            summary=_strip_md(final_report)[:180] if final_report else "综合结论仍在整理三路结果与监控摘要。",
            content=final_report or "",
            source_count=source_counts.get("final", 0) if final_report else 0,
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


def _update_task_snapshot(
    task: AnalysisTask,
    results: dict[str, str],
    news_digest: list[dict[str, str]],
    fallback_map: dict[str, bool],
    status: str,
    progress: int,
    final_report: str = "",
    source_counts: dict[str, int] | None = None,
) -> None:
    source_counts = source_counts or {}
    task.status = status
    task.progress = progress
    task.news_digest = news_digest
    task.source_count = source_counts.get("final", len(news_digest))
    task.fallback_used = any(fallback_map.values())
    task.matched_terms = _extract_query_terms(task.query)
    task.sentiment_hint = _build_sentiment_hint(" ".join([task.query, *results.values(), final_report]))
    task.sections = _build_sections(task.query, results, final_report, fallback_map, source_counts, status)
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
            source_count=source_counts.get(key, 0) if has_content else 0,
            summary=_strip_md(results.get(key, ""))[:120] if has_content else f"{_AGENT_LABELS[key]}正在处理“{task.query}”。",
            fallback_used=bool(fallback_map.get(key)),
            updated_at=datetime.now(UTC),
        )
    agent_metrics["report"] = AnalysisAgentState(
        key="report",
        label=_AGENT_LABELS["report"],
        status="done" if final_report and status in {"completed", "degraded"} else "running" if final_report or status == "assembling" else "queued",
        progress=100 if final_report and status in {"completed", "degraded"} else 68 if status == "assembling" else min(progress, 40),
        source_count=source_counts.get("final", 0) if final_report else 0,
        summary=_strip_md(final_report)[:120] if final_report else "等待三路结果收口后输出综合报告。",
        fallback_used=status == "degraded",
        updated_at=datetime.now(UTC),
    )
    task.agent_metrics = agent_metrics
    if status == "degraded":
        task.degraded_reason = "当前报告已先基于真实来源摘录、监控摘要与结构化线索完成收口，可继续用于观察与推演。"
        task.ui_message = "当前报告已生成降级版，但仍保留真实来源摘录，可继续查看重点结论或进入未来推演。"
    elif status == "completed":
        task.degraded_reason = None
        task.ui_message = "三路结果已汇总完成，可以继续进入未来推演。"
    else:
        task.ui_message = "多代理正在并行研判，结果会按板块陆续到达。"
    if final_report:
        task.final_report = final_report
    task.last_update_at = datetime.now(UTC)
    _persist_analysis_task(task)


def _build_agent_fallback_report(
    query: str,
    agent_key: str,
    news_digest: list[dict[str, str]],
    source_facts: list[dict[str, str]] | None = None,
) -> str:
    lead = {
        "query": "搜索代理体已经切换到公开来源摘录与监控新闻摘要，以下是当前可用的事实线索。",
        "media": "媒体代理体未拿到完整正文时，会先基于真实标题、来源摘录与监控摘要重建叙事脉络。",
        "insight": "洞察代理体未拿到完整社媒数据时，会先根据真实标题、来源线索、地区与信号类型给出观察框架。",
    }[agent_key]
    section_title = {
        "query": "搜索流摘要",
        "media": "媒体脉络摘要",
        "insight": "洞察结构摘要",
    }[agent_key]

    source_facts = source_facts or []
    fact_lines = _format_source_fact_lines(source_facts, limit=4)
    if not fact_lines and not news_digest:
        return f"## {section_title}\n\n围绕“{query}”尚未收集到足够公开素材，系统已切换到结构化框架模式，建议继续观察后续新闻和信号变化。"

    bullets = fact_lines[:]
    if len(bullets) < 4:
        for item in news_digest[: 4 - len(bullets)]:
            bullets.append(
                f"- [{item['country']}] {item['title']}（{item['source']}，{item['published_at']}）\n"
                f"  {item['summary'][:140]}"
            )

    if agent_key == "query":
        closing = "可先据此确认主要地区、事件触发点、来源分布与外部政策动作。"
    elif agent_key == "media":
        closing = "从这些真实标题与摘要看，报道已形成“事件触发—升级信号—外部回应”的叙事链。"
    else:
        closing = "当前最值得继续追踪的是情绪是否继续升温、讨论是否从新闻转向行动预期，以及哪些公开来源正在重复同一信号。"

    return f"## {section_title}\n\n{lead}\n\n" + "\n".join(bullets) + f"\n\n{closing}"


def _build_fallback_final_report(
    query: str,
    results: dict[str, str],
    news_digest: list[dict[str, str]],
    source_facts: list[dict[str, str]],
) -> str:
    lines = [
        f"# {query} — 议题综合研判",
        "",
        f"> 生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        "## 当前判断",
        f"围绕“{query}”的公开线索仍在持续变化。当前报告优先整合真实来源摘录、监控新闻、热点地区与信号类型，先给出一个可以继续观察和推演的综合版，而不是输出空白或失败说明。",
        "",
    ]

    for key, title in (("query", "搜索流"), ("media", "媒体流"), ("insight", "洞察流")):
        content = results.get(key, "").strip()
        if content:
            lines.append(f"## {title}")
            lines.append(content)
            lines.append("")

    if source_facts:
        lines.append("## 公开来源摘录")
        lines.extend(_format_source_fact_lines(source_facts, limit=6))
        lines.append("")

    if news_digest:
        lines.append("## 监控新闻摘录")
        for item in news_digest[:5]:
            lines.append(f"- {item['title']}（{item['country']} · {item['source']} · {item['published_at']}）")
            if item.get("summary"):
                lines.append(f"  {item['summary'][:160]}")
        lines.append("")

    lines.extend([
        "## 下一步建议",
        "1. 优先核查公开来源摘录里反复出现的标题、地区与关键信号，确认它们是否指向同一事件链。",
        "2. 将当前综合观察版送入未来预测，观察参与方、平台与行动链路如何展开。",
        "3. 如果后续正文抓取恢复，再用新增真实素材回填搜索流与媒体流。",
    ])
    return "\n".join(lines)


def _derive_highlights(query: str, news_digest: list[dict[str, str]], results: dict[str, str], source_facts: list[dict[str, str]]) -> list[str]:
    highlights: list[str] = []
    seen: set[str] = set()
    for fact in source_facts[:4]:
        headline = fact.get("title", "").strip()
        source = fact.get("source", "").strip()
        summary = fact.get("summary", "").strip()
        highlight = f"{headline}（{source}）" if headline and source else headline or summary[:100]
        if highlight and highlight not in seen:
            highlights.append(highlight)
            seen.add(highlight)
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


def _build_structured_final_report(
    query: str,
    results: dict[str, str],
    news_digest: list[dict[str, str]],
    fallback_map: dict[str, bool],
    source_facts: list[dict[str, str]],
) -> str:
    highlights = _derive_highlights(query, news_digest, results, source_facts)
    fallback_total = sum(1 for used in fallback_map.values() if used)
    status_note = "当前报告包含真实来源摘录、监控摘要与结构化补全内容。" if fallback_total else "当前报告基于三路真实素材汇总。"
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
    if source_facts:
        lines.append("## 公开来源摘录")
        lines.extend(_format_source_fact_lines(source_facts, limit=8))
        lines.append("")
    if news_digest:
        lines.append("## 监控摘要")
        for item in news_digest[:5]:
            lines.append(f"- {item['title']}（{item['country']} · {item['source']} · {item['published_at']}）")
            if item.get("summary"):
                lines.append(f"  {item['summary'][:160]}")
        lines.append("")
    lines.extend([
        "## 下一步行动",
        "1. 检查当前板块中哪些仍主要依赖监控摘要，优先补齐那些影响判断的关键素材。",
        "2. 如需预演趋势，可将当前综合结论送入未来推演，观察参与方与行动链路。",
        "3. 持续追踪公开来源与地区信号变化，确认风险是否继续升温或转入缓和。",
    ])
    return "\n".join(lines)


def _render_fallback_html(
    query: str,
    merged_markdown: str,
    news_digest: list[dict[str, str]],
    source_facts: list[dict[str, str]],
) -> str:
    content_html = merged_markdown.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    content_html = content_html.replace("\n", "<br/>")
    source_html = "".join(
        (
            "<div class='news-item'>"
            f"<div class='news-title'>{escape(fact.get('title', '未命名来源'))}</div>"
            f"<div class='news-meta'>{escape(' · '.join(part for part in [fact.get('source', ''), fact.get('published_at', ''), fact.get('paragraph_title', '')] if part) or '外部来源')}</div>"
            f"<div class='news-summary'>{escape((fact.get('summary') or '检索已命中该来源，但正文摘要仍在补全。')[:220])}</div>"
            + (
                f"<div class='news-summary'><a href='{escape(fact.get('url', ''))}' target='_blank' rel='noopener'>查看原始链接</a></div>"
                if fact.get('url') else ""
            )
            + "</div>"
        )
        for fact in source_facts[:6]
    )
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
.news-summary a {{ color: #1d4ed8; text-decoration: none; }}
.news-summary a:hover {{ text-decoration: underline; }}
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
      <h2>公开来源摘录</h2>
      {source_html or "<div class='news-summary'>当前暂无可展示的公开来源摘录。</div>"}
    </div>
    <div class="card">
      <h2>监控新闻摘要</h2>
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

    task = _get_task(task_id)
    if not task:
        return {}

    # ── LLM clients (one per agent role) ────────────────────────────────
    query_llm = LLMClient(
        api_key=settings.query_llm.api_key,
        base_url=settings.query_llm.base_url,
        model=settings.query_llm.model,
        provider=settings.query_llm.provider,
        reasoning_split=settings.query_llm.reasoning_split,
        timeout=min(settings.query_llm.timeout, _ANALYSIS_LLM_TIMEOUT_SECONDS),
        max_retries=_ANALYSIS_LLM_MAX_RETRIES,
    )
    media_llm = LLMClient(
        api_key=settings.media_llm.api_key,
        base_url=settings.media_llm.base_url,
        model=settings.media_llm.model,
        provider=settings.media_llm.provider,
        reasoning_split=settings.media_llm.reasoning_split,
        timeout=min(settings.media_llm.timeout, _ANALYSIS_LLM_TIMEOUT_SECONDS),
        max_retries=_ANALYSIS_LLM_MAX_RETRIES,
    )
    insight_llm = LLMClient(
        api_key=settings.insight_llm.api_key,
        base_url=settings.insight_llm.base_url,
        model=settings.insight_llm.model,
        provider=settings.insight_llm.provider,
        reasoning_split=settings.insight_llm.reasoning_split,
        timeout=min(settings.insight_llm.timeout, _ANALYSIS_LLM_TIMEOUT_SECONDS),
        max_retries=_ANALYSIS_LLM_MAX_RETRIES,
    )
    report_llm = LLMClient(
        api_key=settings.report_llm.api_key,
        base_url=settings.report_llm.base_url,
        model=settings.report_llm.model,
        provider=settings.report_llm.provider,
        reasoning_split=settings.report_llm.reasoning_split,
        timeout=min(settings.report_llm.timeout, _ANALYSIS_LLM_TIMEOUT_SECONDS),
        max_retries=_ANALYSIS_LLM_MAX_RETRIES,
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
    async def run_query() -> tuple[str, dict[str, object]]:
        try:
            state = await asyncio.wait_for(
                agents["query"].research(query),
                timeout=240.0,
            )
            source_metrics = getattr(state, "source_metrics", None)
            source_count = max(
                _coerce_int(getattr(source_metrics, "unique_source_count", 0) if source_metrics else 0),
                _coerce_int(getattr(source_metrics, "result_count", 0) if source_metrics else 0),
            )
            return (
                "query",
                {
                    "report": state.final_report or f"{query} 深度研究报告（网络搜索）",
                    "source_count": source_count,
                    "source_facts": _safe_extract_source_facts(state, limit=4),
                },
            )
        except asyncio.TimeoutError:
            return ("query", {"report": f"关于 {query} 的网络舆情搜索（超时）", "source_count": 0, "source_facts": []})
        except Exception:
            return ("query", {"report": f"{query} 网络搜索遇到问题。", "source_count": 0, "source_facts": []})

    async def run_media() -> tuple[str, dict[str, object]]:
        try:
            state = await asyncio.wait_for(
                agents["media"].research(query),
                timeout=240.0,
            )
            source_metrics = getattr(state, "source_metrics", None)
            source_count = max(
                _coerce_int(getattr(source_metrics, "unique_source_count", 0) if source_metrics else 0),
                _coerce_int(getattr(source_metrics, "result_count", 0) if source_metrics else 0),
            )
            return (
                "media",
                {
                    "report": state.final_report or f"{query} 多媒体舆情分析（媒体报道）",
                    "source_count": source_count,
                    "source_facts": _safe_extract_source_facts(state, limit=4),
                },
            )
        except asyncio.TimeoutError:
            return ("media", {"report": f"关于 {query} 的媒体报道分析（超时）", "source_count": 0, "source_facts": []})
        except Exception:
            return ("media", {"report": f"{query} 媒体报道分析遇到问题。", "source_count": 0, "source_facts": []})

    async def run_insight() -> tuple[str, dict[str, object]]:
        try:
            state = await asyncio.wait_for(
                agents["insight"].research(query),
                timeout=240.0,
            )
            source_metrics = getattr(state, "source_metrics", None)
            source_count = max(
                _coerce_int(getattr(source_metrics, "unique_source_count", 0) if source_metrics else 0),
                _coerce_int(getattr(source_metrics, "result_count", 0) if source_metrics else 0),
            )
            return (
                "insight",
                {
                    "report": state.final_report or f"{query} 社交媒体舆情分析（社媒数据）",
                    "source_count": source_count,
                    "source_facts": _safe_extract_source_facts(state, limit=4),
                },
            )
        except asyncio.TimeoutError:
            return ("insight", {"report": f"关于 {query} 的社交媒体分析（超时）", "source_count": 0, "source_facts": []})
        except Exception:
            return ("insight", {"report": f"{query} 社交媒体分析遇到问题。", "source_count": 0, "source_facts": []})

    async def load_digest() -> tuple[str, list[dict[str, str]]]:
        try:
            return ("__digest__", await asyncio.to_thread(_build_fallback_news_digest, query))
        except Exception:
            return ("__digest__", [])

    results: dict[str, str] = {}
    fallback_map: dict[str, bool] = {"query": False, "media": False, "insight": False}
    source_counts: dict[str, int] = {"query": 0, "media": 0, "insight": 0, "final": 0}
    agent_facts: dict[str, list[dict[str, str]]] = {"query": [], "media": [], "insight": []}
    core_jobs = [
        asyncio.create_task(run_query()),
        asyncio.create_task(run_media()),
        asyncio.create_task(run_insight()),
    ]
    digest_task = asyncio.create_task(load_digest())
    news_digest: list[dict[str, str]] = []
    completed = 0

    def consume_digest_result(payload: object) -> None:
        nonlocal news_digest
        latest_digest = payload if isinstance(payload, list) else []
        if latest_digest == news_digest:
            return
        news_digest = latest_digest
        if task:
            first_headline = news_digest[0]["title"] if news_digest else "正在等待外部信息。"
            _append_timeline(
                task,
                _make_timeline_event(
                    "digest",
                    "监控摘要已接入",
                    f"当前已接入 {len(news_digest)} 条监控新闻摘要，最新线索：{first_headline}",
                    "done" if news_digest else "running",
                ),
            )
            if task.status in {"running", "assembling"}:
                task.ui_message = f"已接入 {len(news_digest)} 条监控摘要，多代理正在并行研判。"

    def handle_digest_done(fut: asyncio.Task) -> None:
        try:
            _, payload = fut.result()
        except asyncio.CancelledError:
            return
        except Exception:
            return
        consume_digest_result(payload)

    async def maybe_collect_digest(timeout: float) -> None:
        if digest_task.done():
            try:
                _, payload = await digest_task
            except asyncio.CancelledError:
                return
            except Exception:
                return
            consume_digest_result(payload)
            return
        if timeout <= 0:
            return
        try:
            _, payload = await asyncio.wait_for(asyncio.shield(digest_task), timeout=timeout)
        except asyncio.TimeoutError:
            return
        except asyncio.CancelledError:
            return
        except Exception:
            return
        consume_digest_result(payload)

    digest_task.add_done_callback(handle_digest_done)

    for future in asyncio.as_completed(core_jobs):
        try:
            key, payload = await future
        except Exception:
            continue

        report = payload.get("report", "") if isinstance(payload, dict) else ""
        source_counts[key] = _coerce_int(payload.get("source_count", 0) if isinstance(payload, dict) else 0)
        agent_facts[key] = [
            _normalize_source_fact(fact)
            for fact in (payload.get("source_facts", []) if isinstance(payload, dict) else [])
            if isinstance(fact, dict)
        ]
        if _looks_like_failure_text(report):
            fallback_map[key] = True
            report = _build_agent_fallback_report(query, key, news_digest, agent_facts.get(key, []))
        elif not report.strip() and agent_facts.get(key):
            fallback_map[key] = True
            report = _build_agent_fallback_report(query, key, news_digest, agent_facts.get(key, []))
        results[key] = report

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
                        f"当前板块先使用真实来源摘录与监控摘要作为临时输出，已复用 {max(len(agent_facts.get(key, [])), len(news_digest))} 条线索补齐。"
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
                source_counts={
                    **source_counts,
                    "final": max(sum(source_counts.values()), len(news_digest)),
                },
            )

    await maybe_collect_digest(timeout=1.2)
    merged_source_facts = _merge_source_facts(agent_facts, news_digest)
    graph_calibration = await asyncio.to_thread(_build_graph_calibration, query, news_digest, merged_source_facts)
    source_counts["final"] = max(len(merged_source_facts), sum(source_counts[key] for key in ("query", "media", "insight")), len(news_digest))
    for key, used in fallback_map.items():
        if not used:
            continue
        results[key] = _build_agent_fallback_report(query, key, news_digest, agent_facts.get(key, []))
        if task:
            if key == "query":
                task.query_report = results[key]
            elif key == "media":
                task.media_report = results[key]
            elif key == "insight":
                task.insight_report = results[key]
    merged = _merge_agent_reports(
        query=query,
        query_report=results.get("query", ""),
        media_report=results.get("media", ""),
        insight_report=results.get("insight", ""),
    )
    if _looks_like_failure_text(merged):
        merged = _build_fallback_final_report(query, results, news_digest, merged_source_facts)
    else:
        merged = _build_structured_final_report(query, results, news_digest, fallback_map, merged_source_facts)
    if task:
        task.graph_id = graph_calibration.get("graph_id")  # type: ignore[assignment]
        task.graph_source_mode = str(graph_calibration.get("graph_source_mode") or "")
        task.graph_queries = list(graph_calibration.get("graph_queries") or [])
        task.graph_facts = list(graph_calibration.get("graph_facts") or [])
        task.graph_edges = list(graph_calibration.get("graph_edges") or [])
        task.graph_nodes = list(graph_calibration.get("graph_nodes") or [])
        _append_timeline(task, _make_timeline_event("report", "正在编排综合结论", "三路结果已经汇总，正在去重并生成结构化综合报告。", "running"))
        if task.graph_facts or task.graph_edges or task.graph_nodes:
            _append_timeline(
                task,
                _make_timeline_event(
                    "graph",
                    "图谱校准已接入",
                    f"已从临时知识图谱命中 {len(task.graph_facts)} 条事实、{len(task.graph_edges)} 条关系、{len(task.graph_nodes)} 个节点。",
                    "done",
                ),
            )
        _update_task_snapshot(
            task,
            results=results,
            news_digest=news_digest,
            fallback_map=fallback_map,
            status="assembling",
            progress=86,
            final_report=merged,
            source_counts=source_counts,
        )

    # ── Stage 3: Generate final HTML report ───────────────────────────
    fallback_total = sum(1 for used in fallback_map.values() if used)
    should_skip_report_llm = fallback_total >= 2
    if should_skip_report_llm:
        if task:
            _append_timeline(
                task,
                _make_timeline_event(
                    "render",
                    "已切换快速排版",
                    "检测到多路代理体回退到观察摘要，直接使用结构化结论生成可读 HTML，避免长时间停留在 assembling。",
                    "warning",
                ),
            )
            task.html_report = _render_fallback_html(query, merged, news_digest, merged_source_facts)
    else:
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
                    source_facts="\n".join(_format_source_fact_lines(merged_source_facts, limit=8)),
                ),
                timeout=90.0,
            )
            if _looks_like_failure_text(html):
                html = _render_fallback_html(query, merged, news_digest)
            if task:
                task.html_report = html
        except asyncio.TimeoutError:
            if task:
                task.html_report = _render_fallback_html(query, merged, news_digest, merged_source_facts)
        except Exception as e:
            if task:
                task.html_report = _render_fallback_html(query, f"{merged}\n\n[报告生成器异常：{str(e)}]", news_digest)

    if task:
        task.data_quality = "degraded" if fallback_total >= 3 else "mixed" if fallback_total > 0 else "live"
        task.progress = 100 if fallback_total == 0 else 96 if fallback_total < 3 else 88
        task.status = "degraded" if fallback_total >= 2 else "completed"
        task.sections = _build_sections(query, results, merged, fallback_map, source_counts, task.status)
        task.agent_status = {
            "query": "fallback" if fallback_map.get("query") else "done",
            "media": "fallback" if fallback_map.get("media") else "done",
            "insight": "fallback" if fallback_map.get("insight") else "done",
            "report": "done",
        }
        task.fallback_used = any(fallback_map.values())
        task.source_count = source_counts.get("final", len(news_digest))
        task.news_digest = news_digest
        task.matched_terms = _extract_query_terms(query)
        task.sentiment_hint = _build_sentiment_hint(" ".join([query, *results.values(), merged]))
        task.degraded_reason = "当前报告已先基于真实来源摘录、监控摘要与结构化线索完成收口，可继续用于观察与推演，后续补齐真实素材后会更完整。" if task.status == "degraded" else None
        task.ui_message = "当前报告已生成降级版，但仍保留真实来源摘录，可继续查看重点结论或进入未来推演。" if task.status == "degraded" else "综合研判已完成，可继续进入未来推演。"
        task.agent_metrics = {
            "query": AnalysisAgentState(key="query", label=_AGENT_LABELS["query"], status="fallback" if fallback_map.get("query") else "done", progress=100, source_count=source_counts.get("query", 0), summary=_strip_md(results.get("query", ""))[:120], fallback_used=bool(fallback_map.get("query")), updated_at=datetime.now(UTC)),
            "media": AnalysisAgentState(key="media", label=_AGENT_LABELS["media"], status="fallback" if fallback_map.get("media") else "done", progress=100, source_count=source_counts.get("media", 0), summary=_strip_md(results.get("media", ""))[:120], fallback_used=bool(fallback_map.get("media")), updated_at=datetime.now(UTC)),
            "insight": AnalysisAgentState(key="insight", label=_AGENT_LABELS["insight"], status="fallback" if fallback_map.get("insight") else "done", progress=100, source_count=source_counts.get("insight", 0), summary=_strip_md(results.get("insight", ""))[:120], fallback_used=bool(fallback_map.get("insight")), updated_at=datetime.now(UTC)),
            "report": AnalysisAgentState(key="report", label=_AGENT_LABELS["report"], status="done", progress=100, source_count=source_counts.get("final", 0), summary=_strip_md(merged)[:120], fallback_used=task.status == "degraded", updated_at=datetime.now(UTC)),
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
        _persist_analysis_task(task)
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
    matched_terms = _extract_query_terms(req.query)
    task = AnalysisTask(
        task_id=task_id,
        query=req.query,
        status="running",
        progress=3,
        agent_status={"query": "queued", "media": "queued", "insight": "queued", "report": "queued"},
        agent_metrics=_build_initial_agent_metrics(),
        matched_terms=matched_terms,
        sections=_build_initial_sections(req.query, matched_terms),
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

    try:
        warm_digest = await asyncio.wait_for(
            asyncio.to_thread(_build_fallback_news_digest, req.query),
            timeout=3.0,
        )
    except Exception:
        warm_digest = []

    if warm_digest:
        task.news_digest = warm_digest
        task.source_count = len(warm_digest)
        task.progress = 8
        task.timeline.append(
            _make_timeline_event(
                "warm_digest",
                "监控摘要已预热",
                f"已先接入 {len(warm_digest)} 条监控新闻摘要，页面可先查看最新线索。",
                "done",
            )
        )
        task.ui_message = f"已先接入 {len(warm_digest)} 条监控摘要，多代理研判结果会继续陆续到达。"

    _task_registry[task_id] = task
    _persist_analysis_task(task)

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
        "graph_id": task.graph_id,
        "graph_source_mode": task.graph_source_mode,
        "graph_queries": task.graph_queries,
        "graph_facts": task.graph_facts,
        "graph_edges": task.graph_edges,
        "graph_nodes": task.graph_nodes,
        "source_count": task.source_count,
        "news_digest": task.news_digest,
        "ui_message": task.ui_message,
        "last_update_at": task.last_update_at.isoformat() if task.last_update_at else None,
        "message": "多智能体分析已提交，Query + Media + Insight 并行运行中，请通过 /api/analysis/{task_id} 查询结果",
    }


@router.get("/{task_id}")
async def get_analysis_task(task_id: str) -> dict:
    """Get analysis task status and results"""
    task = _get_task(task_id)
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
        "graph_id": task.graph_id,
        "graph_source_mode": task.graph_source_mode,
        "graph_queries": task.graph_queries,
        "graph_facts": task.graph_facts,
        "graph_edges": task.graph_edges,
        "graph_nodes": task.graph_nodes,
        "last_update_at": task.last_update_at.isoformat() if task.last_update_at else None,
        "query_report": task.query_report,
        "media_report": task.media_report,
        "insight_report": task.insight_report,
        "final_report": task.final_report,
        "html_report": task.html_report,
        "error": task.error,
    }
