"""OrcaFish Intelligence API Routes"""
import asyncio
from typing import List, Optional
from datetime import UTC, datetime
from fastapi import APIRouter, HTTPException
from backend.models.intelligence import CountryScore, FocalPoint
from backend.intelligence import CIIEngine, SignalAggregator
from backend.config import settings
from backend.llm.client import LLMClient

router = APIRouter(prefix="/intelligence", tags=["Intelligence"])

_cii_engine = CIIEngine()
_signal_aggregator = SignalAggregator()

# World Monitor polling state
_wm_running = False
_wm_task: Optional[asyncio.Task] = None
_wm_last_poll: Optional[datetime] = None
_wm_focal_points: List[FocalPoint] = []
_wm_monitor_snapshot_cache: Optional[dict] = None
_wm_cii_payload_cache: Optional[dict] = None
_WM_AGENT_TIMEOUT_SECONDS = 8.0
_wm_lock = asyncio.Lock()


def _normalize_iso(iso: str) -> str:
    return iso.strip().upper()


def _build_monitor_snapshot(domain: Optional[str] = None) -> dict:
    watchlist = _signal_aggregator.get_country_watchlist(limit=12, domain=domain)
    recent_activity = _signal_aggregator.get_recent_activity(limit=18, domain=domain)
    latest_event = recent_activity[0] if recent_activity else None
    total_news = len(_signal_aggregator.get_news_items(domain=domain, limit=240))
    total_signals = len(_signal_aggregator.get_signals())
    active_countries = len({item["iso"] for item in watchlist})

    focus_line = "监控已启动，等待更多实时线索进入。"
    if watchlist:
        lead = watchlist[0]
        focus_line = (
            f"当前最值得盯的是 {lead['iso']}，"
            f"{lead['drivers'][0] if lead.get('drivers') else '监控信号正在抬升'}。"
        )

    return {
        "running": _wm_running,
        "last_poll": _wm_last_poll.isoformat() if _wm_last_poll else None,
        "poll_interval": 15,
        "cii_threshold": 65.0,
        "data_sources": [
            "Google News RSS",
            f"{settings.query_llm.provider.upper()} Monitor Agent",
            "热点信号聚合",
            "人工注入信号",
        ],
        "provider": settings.query_llm.provider,
        "model": settings.query_llm.model,
        "cycle": _signal_aggregator.get_poll_count(),
        "active_countries": active_countries,
        "news_count": total_news,
        "signal_count": total_signals,
        "focal_count": len(_wm_focal_points),
        "latest_event": latest_event,
        "briefing": focus_line,
        "watchlist": watchlist[:6],
    }


def _refresh_monitor_snapshot_cache() -> dict:
    global _wm_monitor_snapshot_cache
    _wm_monitor_snapshot_cache = _build_monitor_snapshot()
    return _wm_monitor_snapshot_cache


def _get_monitor_snapshot() -> dict:
    return _wm_monitor_snapshot_cache or _refresh_monitor_snapshot_cache()


def _build_enriched_cii_payload() -> dict:
    scores = _cii_engine.calculate()
    watchlist_map = {
        item["iso"]: item
        for item in _signal_aggregator.get_country_watchlist(limit=40)
    }
    enriched_scores: dict[str, dict] = {}
    for iso, score in scores.items():
        details = watchlist_map.get(iso, {})
        enriched_scores[iso] = {
            **score,
            "monitoring": details,
        }
    return {
        "scores": enriched_scores,
        "watchlist": list(watchlist_map.values())[:12],
        "monitor": _get_monitor_snapshot(),
        "timestamp": datetime.now(UTC).isoformat(),
    }


def _refresh_cii_payload_cache() -> dict:
    global _wm_cii_payload_cache
    _wm_cii_payload_cache = _build_enriched_cii_payload()
    return _wm_cii_payload_cache


def _get_cii_payload() -> dict:
    return _wm_cii_payload_cache or _refresh_cii_payload_cache()


def _build_country_reasoning(
    normalized_iso: str,
    cluster,
    news_items: list[dict],
    country_signals: list[dict],
) -> dict:
    watchlist = {
        item["iso"]: item
        for item in _signal_aggregator.get_country_watchlist(limit=40)
    }
    selected = watchlist.get(normalized_iso, {})
    latest_items = _signal_aggregator.get_recent_activity(limit=24)
    live_updates = [item for item in latest_items if item.get("country_iso") == normalized_iso][:8]

    top_signal_types = []
    if cluster:
        top_signal_types = sorted(cluster.signal_types)
    elif country_signals:
        top_signal_types = sorted({signal["signal_type"] for signal in country_signals})

    return {
        "drivers": selected.get("drivers", []),
        "rationale": selected.get(
            "rationale",
            f"{normalized_iso} 当前进入监控列表，主要信号类型为{'、'.join(top_signal_types[:3]) or '观察信号'}。",
        ),
        "new_events_15m": selected.get("new_events_15m", 0),
        "source_count": selected.get("source_count", len(news_items)),
        "source_diversity": selected.get("source_diversity", 0),
        "freshness": selected.get("freshness", 0.0),
        "escalation": selected.get("escalation", 0.0),
        "convergence_score": selected.get("convergence_score", cluster.convergence_score if cluster else 0.0),
        "momentum": selected.get("momentum", "watch"),
        "top_signal_types": selected.get("top_signal_types", top_signal_types),
        "top_headlines": selected.get("top_headlines", [item["title"] for item in news_items[:3]]),
        "last_event": selected.get("last_event"),
        "live_updates": live_updates,
    }


def _build_country_context(iso: str) -> dict:
    normalized_iso = _normalize_iso(iso)
    cii_payload = _get_cii_payload()
    scores = cii_payload.get("scores", {})
    if normalized_iso not in scores:
        raise HTTPException(status_code=404, detail="Country not found")

    country_score = scores[normalized_iso]
    country_name = str(country_score.get("name", normalized_iso))
    country_level = str(country_score.get("level", "low"))
    country_score_value = float(country_score.get("score", 0.0))
    country_change_24h = float(country_score.get("change_24h", 0.0))
    country_trend = str(country_score.get("trend", "stable"))
    country_components = country_score.get("components", {})
    news_items = [
        item.model_dump()
        for item in _signal_aggregator.get_news_items(limit=200)
        if item.country_iso == normalized_iso
    ]
    country_signals = [
        signal.model_dump()
        for signal in _signal_aggregator.get_signals()
        if signal.country_iso == normalized_iso
    ]
    cluster = next(
        (cluster for cluster in _signal_aggregator.get_country_clusters() if cluster.country_iso == normalized_iso),
        None,
    )
    focal_points = [
        point.model_dump()
        for point in _wm_focal_points
        if point.entity_id == normalized_iso and point.entity_type == "country"
    ]

    reasoning = _build_country_reasoning(normalized_iso, cluster, news_items, country_signals)
    top_headlines = reasoning["top_headlines"][:4]
    top_signal_types = reasoning["top_signal_types"]

    recent_news_time = news_items[0]["published_at"].isoformat() if news_items and hasattr(news_items[0]["published_at"], "isoformat") else None
    recent_signal_time = country_signals[0]["timestamp"].isoformat() if country_signals and hasattr(country_signals[0]["timestamp"], "isoformat") else None
    latest_activity = max(
        [
            item["published_at"]
            for item in news_items
            if hasattr(item["published_at"], "isoformat")
        ] + [
            signal["timestamp"]
            for signal in country_signals
            if hasattr(signal["timestamp"], "isoformat")
        ],
        default=None,
    )

    news_count = len(news_items)
    signal_count = len(country_signals)
    focal_count = len(focal_points)
    monitor_summary = _get_monitor_snapshot()

    narrative_parts = [
        f"{country_name} 当前 CII 为 {country_score_value:.1f}，处于{country_level}风险水平。",
    ]
    if news_count:
        narrative_parts.append(f"最近同步到 {news_count} 条新闻，重点话题包括{ '、'.join(top_headlines[:2]) if top_headlines else '最新新闻'}。")
    if signal_count:
        narrative_parts.append(f"监控引擎聚合了 {signal_count} 条信号，主要类型为{ '、'.join(top_signal_types[:3]) if top_signal_types else '未分类信号'}。")
    if focal_count:
        narrative_parts.append(f"Agent 已生成 {focal_count} 个焦点对象，可直接进入研判或未来预测。")
    if reasoning["drivers"]:
        narrative_parts.append(f"当前抬升依据包括{ '、'.join(reasoning['drivers'][:3]) }。")

    return {
        "iso": normalized_iso,
        "country": {
            "code": country_score.get("code", normalized_iso),
            "name": country_name,
            "score": country_score_value,
            "level": country_level,
            "trend": country_trend,
            "change_24h": country_change_24h,
            "components": country_components,
            "last_updated": country_score.get("last_updated"),
        },
        "monitor": monitor_summary,
        "summary": {
            "risk_level": country_level,
            "news_count": news_count,
            "signal_count": signal_count,
            "focal_count": focal_count,
            "top_signal_types": top_signal_types,
            "top_headlines": top_headlines,
            "recent_news_time": recent_news_time,
            "recent_signal_time": recent_signal_time,
            "latest_activity": latest_activity.isoformat() if latest_activity and hasattr(latest_activity, "isoformat") else None,
            "narrative": " ".join(narrative_parts),
            "drivers": reasoning["drivers"],
            "rationale": reasoning["rationale"],
            "new_events_15m": reasoning["new_events_15m"],
            "momentum": reasoning["momentum"],
            "source_count": reasoning["source_count"],
            "source_diversity": reasoning["source_diversity"],
            "freshness": reasoning["freshness"],
            "escalation": reasoning["escalation"],
            "convergence_score": reasoning["convergence_score"],
        },
        "news": {
            "count": news_count,
            "items": news_items[:8],
        },
        "signals": {
            "count": signal_count,
            "items": country_signals[:12],
        },
        "focal_points": {
            "count": focal_count,
            "items": focal_points[:5],
        },
        "live_updates": {
            "count": len(reasoning["live_updates"]),
            "items": reasoning["live_updates"],
        },
    }


def _sync_cii_from_signals() -> None:
    _cii_engine.reset()
    clusters = _signal_aggregator.get_country_clusters()
    news_stats = _signal_aggregator.get_country_news_stats()
    for cluster in clusters:
        iso = cluster.country_iso
        if not iso:
            continue
        protests = []
        conflicts = []
        outages = []
        military_flights = 0
        military_vessels = 0
        for signal in cluster.signals:
            if signal.signal_type == "protest":
                protests.extend([{"country_iso": iso, "fatalities": 0}] * max(signal.count, 1))
            elif signal.signal_type in {"conflict", "military"}:
                conflicts.extend([{"country_iso": iso}] * max(signal.count, 1))
            elif signal.signal_type == "internet_outage":
                outages.append({"country_iso": iso, "severity": signal.severity})
            elif signal.signal_type == "military_flight":
                military_flights += max(signal.count, 1)
            elif signal.signal_type == "military_vessel":
                military_vessels += max(signal.count, 1)

        if protests:
            _cii_engine.ingest_protests(protests)
        if conflicts:
            _cii_engine.ingest_conflicts(conflicts)
        if outages:
            _cii_engine.ingest_outages(outages)
        if military_flights or military_vessels:
            _cii_engine.ingest_military(military_flights, military_vessels, iso)
        stats = news_stats.get(iso, {})
        _cii_engine.ingest_news([{
            "country_iso": iso,
            "source_count": max(cluster.total_count, int(stats.get("count", 0))),
            "velocity": round(cluster.convergence_score / 55.0, 2),
            "freshness": round(float(stats.get("freshness", 0.0)), 3),
            "source_diversity": int(stats.get("source_diversity", 0)),
            "escalation": round(float(stats.get("escalation", 0.0)), 3),
        }])


async def _run_monitor_agent() -> None:
    global _wm_focal_points
    news_items = _signal_aggregator.get_news_items(limit=12)
    clusters = _signal_aggregator.get_country_clusters()
    if not news_items and not clusters:
        _wm_focal_points = []
        return

    prompt_news = "\n".join(
        f"- [{item.country_iso or 'GLOBAL'}] {item.title} | {item.summary[:120]} | {item.signal_type} | {item.source}"
        for item in news_items[:10]
    )
    prompt_clusters = "\n".join(
        f"- {cluster.country_iso}: score={cluster.convergence_score}, total={cluster.total_count}, types={','.join(cluster.signal_types)}"
        for cluster in clusters[:8]
    )

    try:
        llm = LLMClient(
            api_key=settings.query_llm.api_key,
            base_url=settings.query_llm.base_url,
            model=settings.query_llm.model,
            provider=settings.query_llm.provider,
            reasoning_split=settings.query_llm.reasoning_split,
            timeout=min(settings.query_llm.timeout, 20),
            max_retries=1,
        )
        result = await asyncio.wait_for(
            llm.invoke_json(
                system_prompt="你是全球风险监控台的实时情报值班官。你的任务是从新闻和信号里提炼出最值得盯的焦点对象。",
                user_prompt=(
                    "请根据以下监控新闻和国家信号，提炼 3 个最重要的焦点对象，返回 JSON：\n"
                    "{\n"
                    '  "focal_points": [\n'
                    '    {"entity_id":"IR","entity_type":"country","focal_score":0.88,"urgency":"watch|high|critical","signal_types":["military"],"top_headlines":["..."],"narrative":"一句到两句说明为什么现在值得追"}\n'
                    "  ]\n"
                    "}\n\n"
                    "要求：必须基于已有素材，不要编造来源；narrative 要像监控台简报；只输出 JSON。\n\n"
                    f"新闻列表：\n{prompt_news}\n\n"
                    f"国家信号：\n{prompt_clusters}"
                ),
                temperature=0.2,
            ),
            timeout=_WM_AGENT_TIMEOUT_SECONDS,
        )
        points = []
        for item in result.get("focal_points", [])[:3]:
            points.append(FocalPoint(
                entity_id=str(item.get("entity_id", "")) or "GLOBAL",
                entity_type=str(item.get("entity_type", "country")),
                focal_score=float(item.get("focal_score", 0.0)),
                urgency=str(item.get("urgency", "watch")),
                signal_types=[str(x) for x in item.get("signal_types", [])[:4]],
                top_headlines=[str(x) for x in item.get("top_headlines", [])[:3]],
                narrative=str(item.get("narrative", ""))[:220],
            ))
        if points:
            _wm_focal_points = points
            return
    except Exception:
        pass

    fallback: list[FocalPoint] = []
    for cluster in clusters[:3]:
        headlines = [item.title for item in news_items if item.country_iso == cluster.country_iso][:3]
        urgency = "critical" if cluster.convergence_score >= 85 else "high" if cluster.convergence_score >= 55 else "watch"
        fallback.append(FocalPoint(
            entity_id=cluster.country_iso,
            entity_type="country",
            focal_score=min(cluster.convergence_score / 100.0, 0.99),
            urgency=urgency,
            signal_types=cluster.signal_types[:4],
            top_headlines=headlines,
            narrative=f"{cluster.country_iso} 当前聚合了 {cluster.total_count} 个信号，类型覆盖 {', '.join(cluster.signal_types[:3]) or '观察中'}，适合继续追踪后续升级。",
        ))
    _wm_focal_points = fallback


async def _refresh_world_monitor_once() -> None:
    global _wm_last_poll
    _wm_last_poll = datetime.now(UTC)
    await asyncio.to_thread(_run_monitor_poll_cycle)
    try:
        await _run_monitor_agent()
    except Exception:
        # _run_monitor_agent already falls back aggressively; this is only a final guard.
        pass
    _refresh_monitor_snapshot_cache()
    _refresh_cii_payload_cache()


def _run_monitor_poll_cycle() -> None:
    _signal_aggregator.poll_external_sources()
    _sync_cii_from_signals()
    _refresh_monitor_snapshot_cache()
    _refresh_cii_payload_cache()


@router.get("/world-monitor/status")
async def get_wm_status() -> dict:
    """Get World Monitor polling status"""
    return _get_monitor_snapshot()


@router.post("/world-monitor/start")
async def start_wm() -> dict:
    """Start the World Monitor background polling loop"""
    global _wm_running, _wm_task, _wm_last_poll
    async with _wm_lock:
        if _wm_running and _wm_task and not _wm_task.done():
            return {"status": "already_running"}
        try:
            await _refresh_world_monitor_once()
        except Exception as exc:
            _wm_running = False
            _wm_task = None
            _refresh_monitor_snapshot_cache()
            _refresh_cii_payload_cache()
            raise HTTPException(status_code=503, detail=f"世界监控启动失败：{exc}") from exc

        _wm_running = True
        _wm_last_poll = datetime.now(UTC)
        _refresh_monitor_snapshot_cache()
        _refresh_cii_payload_cache()

        async def poll_loop():
            global _wm_running, _wm_task
            try:
                while _wm_running:
                    try:
                        await _refresh_world_monitor_once()
                    except Exception:
                        pass
                    await asyncio.sleep(15)
            finally:
                if _wm_task and _wm_task.done():
                    _wm_task = None
                if not _wm_running:
                    _refresh_monitor_snapshot_cache()
                    _refresh_cii_payload_cache()

        _wm_task = asyncio.create_task(poll_loop())
        return {"status": "started"}


@router.post("/world-monitor/stop")
async def stop_wm() -> dict:
    """Stop the World Monitor background polling loop"""
    global _wm_running, _wm_task
    async with _wm_lock:
        _wm_running = False
        task = _wm_task
        _wm_task = None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        _refresh_monitor_snapshot_cache()
        _refresh_cii_payload_cache()
        return {"status": "stopped"}


@router.get("/cii")
async def get_cii_scores() -> dict:
    """Get CII scores for all monitored countries"""
    return _get_cii_payload()


@router.get("/cii/{iso}")
async def get_country_cii(iso: str) -> dict:
    """Get CII details for a specific country"""
    scores = _cii_engine.calculate()
    if iso not in scores:
        raise HTTPException(status_code=404, detail="Country not found")
    return scores[iso]


@router.get("/signals")
async def get_signals(domain: Optional[str] = None) -> dict:
    """Get current signal aggregation, optionally filtered by domain"""
    clusters = _signal_aggregator.get_country_clusters(domain=domain)
    return {
        "clusters": [c.model_dump() for c in clusters],
        "regional": [r.model_dump() for r in _signal_aggregator.get_regional_convergence(domain=domain)],
        "news": [n.model_dump() for n in _signal_aggregator.get_news_items(domain=domain)],
        "activity": _signal_aggregator.get_recent_activity(limit=18, domain=domain),
        "watchlist": _signal_aggregator.get_country_watchlist(limit=12, domain=domain),
        "domain": domain or "all",
    }


@router.get("/news")
async def get_news(domain: Optional[str] = None, limit: int = 30) -> dict:
    items = _signal_aggregator.get_news_items(domain=domain, limit=limit)
    return {
        "items": [item.model_dump() for item in items],
        "count": len(items),
        "domain": domain or "all",
        "timestamp": datetime.now(UTC).isoformat(),
    }


@router.get("/focal-points")
async def get_focal_points() -> dict:
    return {
        "items": [item.model_dump() for item in _wm_focal_points],
        "count": len(_wm_focal_points),
        "timestamp": datetime.now(UTC).isoformat(),
        "provider": settings.query_llm.provider,
        "model": settings.query_llm.model,
    }


@router.get("/country-context/{iso}")
async def get_country_context(iso: str) -> dict:
    """Get a unified context bundle for one country"""
    return _build_country_context(iso)


@router.get("/signals/convergence")
async def get_convergence() -> dict:
    """Get convergence zones (regional signal clustering)"""
    zones = _signal_aggregator.get_regional_convergence()
    return {
        "zones": [z.model_dump() for z in zones],
        "count": len(zones),
        "timestamp": datetime.now(UTC).isoformat(),
    }


@router.post("/ingest")
async def ingest_signals(data: dict) -> dict:
    """Ingest external signal data (webhook entry)"""
    signal_type = data.get("type", "")
    payload = data.get("data", [])

    if signal_type == "outages":
        _signal_aggregator.ingest_outages(payload)
    elif signal_type == "flights":
        _signal_aggregator.ingest_flights(payload)
    elif signal_type == "vessels":
        _signal_aggregator.ingest_vessels(payload)
    elif signal_type == "protests":
        _signal_aggregator.ingest_protests(payload)
    elif signal_type == "conflicts":
        _signal_aggregator.ingest_conflict_events(payload)

    return {"status": "ok", "ingested": len(payload)}
