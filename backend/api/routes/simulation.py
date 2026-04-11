from __future__ import annotations
"""OrcaFish Simulation API Routes"""
import uuid
import os
import json
import re
import asyncio
from html import escape
from datetime import UTC, datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.models.simulation import (
    SimulationCreateRequest, VariableInjection,
    AgentProfile, AgentStats, RoundSummary,
    SimulationRunState, InterviewRequest, BatchInterviewRequest,
    KGData, GraphNode, GraphEdge
)
from backend.simulation import (
    OntologyGenerator, GraphBuilder, OASISRunner, SimulationIPC, SimulationReportAgent
)
from backend.simulation.manager import SimulationManager
from backend.simulation.runner import SimulationRunner
from backend.llm.client import LLMClient
from backend.config import settings

router = APIRouter(prefix="/simulation", tags=["Simulation"])


def _simulation_data_dir() -> str:
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    os.makedirs(data_dir, exist_ok=True)
    return data_dir


_RUNNER = OASISRunner(data_dir=_simulation_data_dir())
_CREATE_TASK = asyncio.create_task


# Canonical run-based simulation routes used by the current frontend.
# Legacy endpoints below remain for compatibility only and should not be used by
# the active Analysis -> /simulation workbench flow.
# In-memory simulation run registry (replace with DB in production)
_run_registry: Dict[str, dict] = {}

# Default scenarios
_DEFAULT_SCENARIOS = [
    {"id": "default", "name": "通用情景", "description": "基于通用议题的默认未来预测配置"},
    {"id": "military", "name": "军事冲突", "description": "预测军事冲突升级后的多方反应"},
    {"id": "diplomatic", "name": "外交博弈", "description": "预测多国外交斡旋与谈判过程"},
    {"id": "economic", "name": "经济制裁", "description": "预测经济制裁影响与反制措施"},
]

_ENTITY_KEYWORDS: List[Tuple[str, str]] = [
    ("中国", "Actor"), ("美国", "Actor"), ("俄罗斯", "Actor"), ("乌克兰", "Actor"),
    ("欧盟", "Actor"), ("北约", "Actor"), ("日本", "Actor"), ("韩国", "Actor"),
    ("伊朗", "Actor"), ("以色列", "Actor"), ("台海", "Region"), ("台湾", "Region"),
    ("南海", "Region"), ("中东", "Region"), ("朝鲜半岛", "Region"), ("欧洲", "Region"),
    ("制裁", "Concept"), ("冲突", "Concept"), ("军演", "Concept"), ("停火", "Concept"),
    ("舆论", "Concept"), ("外交", "Concept"), ("经济", "Concept"), ("能源", "Concept"),
]

_AGENT_ROLE_NAMES = {
    "twitter": ["广场快讯员", "态势解读员", "趋势观察员", "舆论放大者", "热点追踪员", "风险提示员", "议题串联员", "传播分析员"],
    "reddit": ["社区版主", "深潜研究员", "争议记录员", "观点整合员", "信息考证员", "脉络梳理员", "情绪测温员", "讨论归纳员"],
}

_RELATION_LABELS = {
    "focuses_on": "指向预测目标",
    "spreads_on": "在此平台发酵",
    "relates_to": "关联核心实体",
    "appears_on": "平台高频出现",
    "observes": "持续关注议题",
    "active_on": "活跃于该平台",
    "interacts_with": "发生互动",
    "discusses": "讨论该实体",
    "initiates": "发起动作",
    "published_on": "发布到平台",
    "targets": "影响对象",
    "references": "提及实体",
    "contributes_to": "推动路径演化",
    "stance_similarity": "预测立场接近",
    "co_occurs_with": "共同卷入议题",
    "drives": "驱动议题热度",
    "responds_to": "回应对方动作",
    "amplifies": "放大该话题",
    "signals": "释放风险信号",
}


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _safe_number(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _agent_display(agent_id: str, agent_name: Optional[str] = None) -> Dict[str, str]:
    raw = agent_id or ""
    alias = _normalize_text(agent_name or "")
    platform = "twitter" if "_tw_" in raw else "reddit" if "_rd_" in raw else "unknown"
    role_pool = _AGENT_ROLE_NAMES.get(platform, [])
    match = re.search(r"_(\d+)$", raw)
    index = int(match.group(1)) if match else 0
    role = role_pool[index % len(role_pool)] if role_pool else "预测代理体"
    platform_name = "信息广场" if platform == "twitter" else "话题社区" if platform == "reddit" else "未来平台"
    display_name = f"{role}{index + 1}"
    if alias.startswith("@"):
        display_name = f"{role}{index + 1}（{alias}）"
    elif alias.startswith("u/"):
        display_name = f"{role}{index + 1}（{alias}）"
    summary = f"{display_name}，负责在{platform_name}追踪话题扩散、情绪变化与互动反馈。"
    return {
        "display_name": display_name,
        "platform": platform,
        "platform_name": platform_name,
        "role": role,
        "summary": summary,
    }


def _normalize_topic_name(value: str) -> str:
    text = _normalize_text(value)
    if not text:
        return ""
    text = re.sub(r"[#@>\-\*`]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if text.startswith("观点") or text.startswith("讨论帖"):
        parts = re.split(r"[：:]", text, maxsplit=1)
        if len(parts) == 2:
            text = parts[1].strip()
    if len(text) > 18:
        text = text[:18].rstrip()
    return text


def _extract_action_topics(action: dict) -> List[str]:
    args = action.get("action_args", {}) or {}
    candidates = [
        _normalize_topic_name(str(args.get("topic") or "")),
    ]
    content = _normalize_text(str(args.get("content") or args.get("text") or ""))
    if content:
        candidates.extend(_normalize_topic_name(item) for item in re.findall(r"#?([一-龥]{2,8})", content))
    seen: Set[str] = set()
    topics: List[str] = []
    for item in candidates:
        if not item or item in seen:
            continue
        if item in {"生成时间", "舆情综合分析报告", "社交媒体舆情分析", "媒体报道与多媒体分析", "深度网络舆情研究"}:
            continue
        seen.add(item)
        topics.append(item)
        if len(topics) >= 4:
            break
    return topics


def _extract_seed_entities(text: str) -> List[Dict[str, str]]:
    content = _normalize_text(text)
    if not content:
        return []

    entities: List[Dict[str, str]] = []
    seen: Set[str] = set()
    for keyword, entity_type in _ENTITY_KEYWORDS:
        if keyword in content and keyword not in seen:
            seen.add(keyword)
            entities.append({"name": keyword, "type": entity_type})

    phrases = re.findall(r"[一-龥]{2,8}", content)
    for phrase in phrases:
        if phrase in seen or phrase in {"未来", "预测", "议题", "推演", "平台", "关系", "报告"}:
            continue
        if any(part in phrase for part in ["局势", "升级", "风险", "态势", "传播", "演化"]):
            seen.add(phrase)
            entities.append({"name": phrase, "type": "Concept"})
        if len(entities) >= 12:
            break
    return entities[:12]


def _append_node(nodes: List[GraphNode], seen_nodes: Set[str], node_id: str, name: str, node_type: str, **properties) -> None:
    if node_id in seen_nodes:
        return
    seen_nodes.add(node_id)
    summary = _normalize_text(str(properties.get("summary") or ""))
    created_at = properties.get("created_at")
    raw_attributes = properties.get("attributes")
    attributes = dict(raw_attributes) if isinstance(raw_attributes, dict) else {}
    raw_labels = properties.get("labels")
    labels = [node_type]
    if isinstance(raw_labels, list):
        labels.extend(str(label) for label in raw_labels if str(label).strip())
    elif raw_labels:
        labels.append(str(raw_labels))
    node_properties = dict(properties)
    node_properties.pop("attributes", None)
    node_properties.pop("labels", None)
    normalized_labels = list(dict.fromkeys(label for label in labels if label))
    merged_attributes = dict(node_properties)
    merged_attributes.update(attributes)
    nodes.append(
        GraphNode(
            id=node_id,
            uuid=str(properties.get("uuid") or node_id),
            name=name,
            type=node_type,
            labels=normalized_labels,
            summary=summary,
            attributes=merged_attributes,
            properties=node_properties,
            created_at=str(created_at) if created_at else None,
        )
    )


def _append_edge(
    edges: List[GraphEdge],
    seen_edges: Set[Tuple[str, str, str]],
    source: str,
    target: str,
    edge_type: str,
    label: str,
    weight: float = 1.0,
    fact: str = "",
    **properties,
) -> None:
    edge_key = (source, target, edge_type)
    if edge_key in seen_edges:
        return
    seen_edges.add(edge_key)
    raw_attributes = properties.get("attributes")
    attributes = dict(raw_attributes) if isinstance(raw_attributes, dict) else {}
    episodes = properties.get("episodes")
    edge_episodes = list(episodes) if isinstance(episodes, list) else []
    edge_attributes = dict(properties)
    edge_attributes.pop("attributes", None)
    edge_attributes.pop("episodes", None)
    edge_attributes["weight"] = weight
    edge_attributes["label"] = label
    edge_attributes["fact"] = fact or label
    edges.append(
        GraphEdge(
            source=source,
            target=target,
            uuid=str(properties.get("uuid") or f"{edge_type}::{source}::{target}"),
            type=edge_type,
            fact_type=str(properties.get("fact_type") or edge_type),
            weight=weight,
            label=label,
            name=str(properties.get("name") or label),
            fact=str(properties.get("fact") or fact or label),
            source_node_uuid=str(properties.get("source_node_uuid") or source),
            target_node_uuid=str(properties.get("target_node_uuid") or target),
            source_node_name=str(properties.get("source_node_name") or ""),
            target_node_name=str(properties.get("target_node_name") or ""),
            attributes={**edge_attributes, **attributes},
            created_at=str(properties.get("created_at")) if properties.get("created_at") else None,
            valid_at=str(properties.get("valid_at")) if properties.get("valid_at") else None,
            invalid_at=str(properties.get("invalid_at")) if properties.get("invalid_at") else None,
            expired_at=str(properties.get("expired_at")) if properties.get("expired_at") else None,
            episodes=edge_episodes,
        )
    )


def _short_agent_name(agent_id: str) -> str:
    return _agent_display(agent_id).get("display_name", agent_id[:14])


def _preview_action(args: dict) -> str:
    for key in ("content", "text"):
        value = args.get(key)
        if value:
            return _normalize_text(str(value))[:80]
    if args.get("target_user"):
        return f"@{args['target_user']}"
    if args.get("post_id"):
        return f"帖子 {args['post_id']}"
    topic = _normalize_topic_name(str(args.get("topic") or ""))
    if topic:
        return f"围绕“{topic}”出现动作"
    return "动作已记录"


def _humanize_action_title(action_type: str, platform: str, args: dict) -> str:
    normalized = _normalize_text(action_type).lower()
    platform_name = "信息广场" if platform == "twitter" else "话题社区" if platform == "reddit" else "未来平台"
    topic = _normalize_topic_name(str(args.get("topic") or ""))
    target_user = _normalize_text(str(args.get("target_user") or ""))
    if "reply" in normalized or target_user:
        suffix = f"回应 {target_user}" if target_user else "进行回应"
        return f"{platform_name}回应动作 · {suffix}"
    if "retweet" in normalized or "repost" in normalized or "share" in normalized:
        return f"{platform_name}扩散动作 · {topic or '放大话题'}"
    if "comment" in normalized:
        return f"{platform_name}评论动作 · {topic or '观点评论'}"
    if "post" in normalized or "tweet" in normalized or "publish" in normalized:
        return f"{platform_name}发布动作 · {topic or '发布新观点'}"
    if topic:
        return f"{platform_name}动态 · {topic}"
    return f"{platform_name}动态更新"


def _chunk_seed_content(seed_content: str, chunk_size: int = 500, max_chars: int = 5000) -> List[str]:
    trimmed = (seed_content or "")[:max_chars]
    return [
        trimmed[index:index + chunk_size]
        for index in range(0, len(trimmed), chunk_size)
        if trimmed[index:index + chunk_size].strip()
    ]


def _default_graph_metadata() -> Dict[str, Any]:
    return {
        "project_id": "",
        "graph_id": "",
        "graph_source": "local_only",
        "graph_entity_count": 0,
        "graph_relation_count": 0,
        "graph_entity_types": [],
        "graph_synced_at": None,
        "node_count": 0,
        "edge_count": 0,
    }


def _map_remote_type(labels: List[str], fallback: str = "Entity") -> str:
    normalized = [str(label) for label in labels if str(label).strip()]
    if "Episode" in normalized:
        return "Episode"
    if any(label in {"Actor", "Region", "Concept", "Platform", "Agent", "Action", "Goal", "Event", "Episode"} for label in normalized):
        for candidate in ("Episode", "Event", "Goal", "Actor", "Region", "Concept", "Platform", "Agent", "Action"):
            if candidate in normalized:
                return candidate
    return fallback


def _convert_remote_graph_data(graph_data: Dict[str, Any]) -> Tuple[List[GraphNode], List[GraphEdge]]:
    nodes: List[GraphNode] = []
    edges: List[GraphEdge] = []
    seen_nodes: Set[str] = set()
    seen_edges: Set[Tuple[str, str, str]] = set()

    for raw_node in graph_data.get("nodes") or []:
        if not isinstance(raw_node, dict):
            continue
        node_id = str(raw_node.get("uuid") or raw_node.get("id") or "")
        if not node_id:
            continue
        labels = [str(label) for label in (raw_node.get("labels") or []) if str(label).strip()]
        node_type = _map_remote_type(labels, "Entity")
        _append_node(
            nodes,
            seen_nodes,
            node_id,
            str(raw_node.get("name") or raw_node.get("summary") or node_id),
            node_type,
            uuid=node_id,
            labels=labels,
            summary=str(raw_node.get("summary") or ""),
            attributes=raw_node.get("attributes") if isinstance(raw_node.get("attributes"), dict) else {},
            created_at=raw_node.get("created_at"),
            source="graphiti",
        )

    for raw_edge in graph_data.get("edges") or []:
        if not isinstance(raw_edge, dict):
            continue
        source = str(raw_edge.get("source_node_uuid") or raw_edge.get("source") or "")
        target = str(raw_edge.get("target_node_uuid") or raw_edge.get("target") or "")
        if not source or not target:
            continue
        edge_type = str(raw_edge.get("fact_type") or raw_edge.get("type") or raw_edge.get("name") or "related_to")
        fact = str(raw_edge.get("fact") or raw_edge.get("name") or "")
        _append_edge(
            edges,
            seen_edges,
            source,
            target,
            edge_type,
            _RELATION_LABELS.get(edge_type, fact or edge_type),
            float((raw_edge.get("attributes") or {}).get("weight", 0.88)) if isinstance(raw_edge.get("attributes"), dict) else 0.88,
            fact=fact,
            uuid=str(raw_edge.get("uuid") or f"{edge_type}::{source}::{target}"),
            name=str(raw_edge.get("name") or edge_type),
            fact_type=edge_type,
            source_node_uuid=source,
            target_node_uuid=target,
            source_node_name=str(raw_edge.get("source_node_name") or ""),
            target_node_name=str(raw_edge.get("target_node_name") or ""),
            attributes=raw_edge.get("attributes") if isinstance(raw_edge.get("attributes"), dict) else {},
            created_at=raw_edge.get("created_at"),
            valid_at=raw_edge.get("valid_at"),
            invalid_at=raw_edge.get("invalid_at"),
            expired_at=raw_edge.get("expired_at"),
            episodes=raw_edge.get("episodes") if isinstance(raw_edge.get("episodes"), list) else [],
        )
    return nodes, edges


def _provision_run_graph(req: SimulationCreateRequest) -> Dict[str, Any]:
    metadata = _default_graph_metadata()
    try:
        from backend.graph import GraphBuilder as RemoteGraphBuilder

        builder = RemoteGraphBuilder()
        graph_id = builder.create_graph(name=req.name)
        chunks = _chunk_seed_content(req.seed_content)
        if chunks:
            episode_ids = builder.add_text_batch(graph_id, chunks)
            builder.wait_for_processing(episode_ids)
        graph_info = builder.get_graph_info(graph_id)
        return {
            "project_id": graph_id,
            "graph_id": graph_id,
            "graph_source": "graphiti",
            "graph_entity_count": graph_info.node_count,
            "graph_relation_count": graph_info.edge_count,
            "graph_entity_types": graph_info.entity_types,
            "graph_synced_at": datetime.now(UTC).isoformat(),
            "node_count": graph_info.node_count,
            "edge_count": graph_info.edge_count,
        }
    except Exception:
        return metadata


def _refresh_run_graph_metadata(run: dict) -> Dict[str, Any]:
    graph_id = str(run.get("graph_id") or "")
    if not graph_id:
        return _default_graph_metadata()

    current_types = run.get("graph_entity_types") or []
    metadata = {
        "project_id": str(run.get("project_id") or graph_id),
        "graph_id": graph_id,
        "graph_source": str(run.get("graph_source") or "graphiti"),
        "graph_entity_count": int(run.get("graph_entity_count") or 0),
        "graph_relation_count": int(run.get("graph_relation_count") or 0),
        "graph_entity_types": list(current_types) if isinstance(current_types, list) else [],
        "graph_synced_at": run.get("graph_synced_at"),
        "node_count": int(run.get("node_count") or run.get("graph_entity_count") or 0),
        "edge_count": int(run.get("edge_count") or run.get("graph_relation_count") or 0),
    }

    try:
        from backend.graph import GraphBuilder as RemoteGraphBuilder

        graph_info = RemoteGraphBuilder().get_graph_info(graph_id)
        if graph_info.node_count or graph_info.edge_count or graph_info.entity_types:
            metadata["graph_entity_count"] = graph_info.node_count
            metadata["graph_relation_count"] = graph_info.edge_count
            metadata["graph_entity_types"] = graph_info.entity_types
            metadata["graph_synced_at"] = datetime.now(UTC).isoformat()
            metadata["node_count"] = graph_info.node_count
            metadata["edge_count"] = graph_info.edge_count
    except Exception:
        return metadata

    return metadata


# ── Scenarios ──────────────────────────────────────────────────────────────────

class Scenario(BaseModel):
    id: str
    name: str
    description: str


@router.get("/scenarios")
async def list_scenarios() -> dict:
    """List available simulation scenarios"""
    return {"scenarios": _DEFAULT_SCENARIOS}


# ── Runs ───────────────────────────────────────────────────────────────────────

@router.get("/runs")
async def list_runs() -> dict:
    """List all simulation runs"""
    return {"runs": list(_run_registry.values())}


@router.post("/runs")
async def create_run(req: SimulationCreateRequest) -> dict:
    """Create a new simulation run without starting it immediately"""
    run_id = f"run_{uuid.uuid4().hex[:12]}"
    sim_id = f"sim_{uuid.uuid4().hex[:12]}"
    graph_metadata = _provision_run_graph(req)

    data_dir = _simulation_data_dir()
    sim_dir = os.path.join(data_dir, sim_id)
    os.makedirs(sim_dir, exist_ok=True)

    run_config = {
        "name": req.name,
        "seed_content": req.seed_content,
        "simulation_requirement": req.simulation_requirement,
        "max_rounds": req.max_rounds,
        "enable_twitter": req.enable_twitter,
        "enable_reddit": req.enable_reddit,
    }

    config_path = os.path.join(sim_dir, "simulation_config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump({
            "simulation_id": sim_id,
            **run_config,
            **graph_metadata,
            "time_config": {"total_rounds": req.max_rounds},
        }, f, ensure_ascii=False, indent=2)

    # Register the run
    run = {
        "run_id": run_id,
        "simulation_id": sim_id,
        "status": "created",
        "stop_requested": False,
        "rounds_completed": 0,
        "convergence_achieved": False,
        "scenario": req.name,
        "max_rounds": req.max_rounds,
        "created_at": datetime.now(UTC).isoformat(),
        "started_at": None,
        "final_states": [],
        "duration_ms": None,
        "seed_content": req.seed_content,
        "simulation_requirement": req.simulation_requirement,
        "run_config": run_config,
        **graph_metadata,
    }
    _run_registry[run_id] = run

    return run


@router.delete("/runs/{run_id}")
async def delete_run(run_id: str) -> dict:
    """Delete a simulation run"""
    run = _run_registry.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    sim_id = run.get("simulation_id")
    if sim_id and run.get("status") == "running":
        run["stop_requested"] = True
        await _RUNNER.stop(sim_id)

    del _run_registry[run_id]
    return {"status": "deleted", "run_id": run_id}


@router.get("/runs/{run_id}")
async def get_run(run_id: str) -> dict:
    """Get a specific simulation run"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")
    return _run_registry[run_id]


async def _run_simulation_bg(run_id: str, sim_id: str, req: SimulationCreateRequest):
    """Background simulation执行 — 启动 OASIS mock 循环，等待完成后写入 final_states"""
    import asyncio

    run = _run_registry.get(run_id)
    if not run:
        return

    run["status"] = "running"
    run["stop_requested"] = False
    started_at = datetime.now(UTC)
    run["started_at"] = started_at.isoformat()

    try:
        data_dir = _simulation_data_dir()
        sim_dir = os.path.join(data_dir, sim_id)
        os.makedirs(sim_dir, exist_ok=True)

        # 写入完整配置文件，保持与 create_run 的 run_config 一致
        config_path = os.path.join(sim_dir, "simulation_config.json")
        with open(config_path, "w", encoding="utf-8") as f:
            json.dump({
                "simulation_id": sim_id,
                "name": req.name,
                "seed_content": req.seed_content,
                "simulation_requirement": req.simulation_requirement,
                "max_rounds": req.max_rounds,
                "enable_twitter": req.enable_twitter,
                "enable_reddit": req.enable_reddit,
                "project_id": run.get("project_id", ""),
                "graph_id": run.get("graph_id", ""),
                "graph_source": run.get("graph_source", "local_only"),
                "graph_entity_count": run.get("graph_entity_count", 0),
                "graph_relation_count": run.get("graph_relation_count", 0),
                "graph_entity_types": run.get("graph_entity_types", []),
                "graph_synced_at": run.get("graph_synced_at"),
                "time_config": {"total_rounds": req.max_rounds},
            }, f, ensure_ascii=False, indent=2)

        await _RUNNER.start(
            simulation_id=sim_id,
            sim_dir=sim_dir,
            max_rounds=req.max_rounds,
            enable_twitter=req.enable_twitter,
            enable_reddit=req.enable_reddit,
        )

        # 轮询等待仿真完成
        for _ in range(600):  # 最多等 5 分钟
            await asyncio.sleep(0.5)
            run = _run_registry.get(run_id)
            if not run:
                return

            status = await _RUNNER.get_status(sim_id)
            run["rounds_completed"] = status.current_round

            if run.get("stop_requested"):
                run["status"] = "paused"
                break

            run["status"] = status.status
            if status.status in ("completed", "failed", "paused"):
                break

        # 仿真结束，加载 final_states（从 actions.jsonl 提取 agent 信息）
        final_states = []
        actions_file = os.path.join(sim_dir, "actions.jsonl")
        if os.path.exists(actions_file):
            seen_agents: Dict[str, Dict[str, float]] = {}
            with open(actions_file, encoding='utf-8') as f:
                for line in f:
                    if line.strip():
                        try:
                            entry = json.loads(line)
                            agent_id = entry.get("agent_id", "")
                            if agent_id and agent_id not in seen_agents:
                                seen_agents[agent_id] = {
                                    "actions": 0,
                                    "belief_sum": 0.0,
                                    "influence_sum": 0.0,
                                }
                            if agent_id in seen_agents:
                                seen_agents[agent_id]["actions"] += 1
                                # 模拟信念漂移：不同平台/轮次有不同信念
                                base = hash(agent_id) % 100 / 100
                                seen_agents[agent_id]["belief_sum"] += 0.3 + base * 0.5
                                seen_agents[agent_id]["influence_sum"] += 0.2 + (seen_agents[agent_id]["actions"] / 50)
                        except Exception:
                            pass

            for aid, s in seen_agents.items():
                import random as _r
                belief = min(s["belief_sum"] / max(s["actions"], 1), 0.99)
                influence = min(s["influence_sum"] / max(s["actions"], 1), 0.99)
                # 在 [-1, 1] 范围内生成位置
                px = _r.uniform(-0.9, 0.9)
                py = _r.uniform(-0.9, 0.9)
                final_states.append({
                    "id": aid,
                    "position": [px, py],
                    "belief": round(belief, 4),
                    "influence": round(influence, 4),
                    "actions": s["actions"],
                })

        run = _run_registry.get(run_id)
        if not run:
            return

        run["final_states"] = final_states
        run["convergence_achieved"] = run["status"] == "completed"
        run["duration_ms"] = int((datetime.now(UTC) - started_at).total_seconds() * 1000)

    except Exception as e:
        run = _run_registry.get(run_id)
        if not run:
            return
        run["status"] = "paused" if run.get("stop_requested") else "failed"
        if not run.get("stop_requested"):
            run["error"] = str(e)
        run["duration_ms"] = int((datetime.now(UTC) - started_at).total_seconds() * 1000)


# ── Legacy compatibility endpoints ───────────────────────────────────────────
# These routes are kept only for backward compatibility.
# The active OrcaFish workbench flow must use /simulation/runs* exclusively.

@router.post("/create")
async def create_simulation(req: SimulationCreateRequest) -> dict:
    """Legacy compatibility endpoint. Create a legacy simulation project."""
    from backend.graph import GraphBuilder

    # 通过 Zep CE HTTP 接口创建图谱
    builder = GraphBuilder()  # 从 config 读取 zep_base_url / zep_api_secret
    graph_id = builder.create_graph(name=req.name)
    # 将 seed_content 分块写入
    chunks = [req.seed_content[i:i+500] for i in range(0, min(len(req.seed_content), 5000), 500)]
    builder.add_text_batch(graph_id, chunks)

    sim_id = f"sim_{uuid.uuid4().hex[:12]}"
    runner = OASISRunner()
    sim_id_out, sim_dir = runner.create_simulation({
        "simulation_id": sim_id,
        "project_id": graph_id,
        "graph_id": graph_id,
    })

    graph_info = builder.get_graph_info(graph_id)
    return {
        "project_id": graph_id,
        "simulation_id": sim_id_out,
        "graph_id": graph_id,
        "ontology": {},
        "entity_count": graph_info.node_count,
    }


@router.post("/{simulation_id}/start")
async def start_simulation(simulation_id: str) -> dict:
    """Legacy compatibility endpoint. Start a legacy simulation by simulation_id."""
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    sim_dir = os.path.join(data_dir, simulation_id)
    runner = OASISRunner(data_dir=data_dir)
    status = await runner.start(
        simulation_id=simulation_id,
        sim_dir=sim_dir,
        max_rounds=settings.simulation_rounds,
    )
    return {"simulation_id": simulation_id, "status": status.status}


@router.post("/{simulation_id}/inject")
async def inject_variable(
    simulation_id: str,
    req: VariableInjection,
) -> dict:
    """God-mode variable injection into simulation"""
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    sim_dir = os.path.join(data_dir, simulation_id)
    ipc = SimulationIPC(sim_dir)
    result = await ipc.interview_all_agents(
        simulation_id=simulation_id,
        prompt=f"【系统外部事件注入】{req.description}，变量: {req.variable}={req.value}",
    )
    return {"result": result}


@router.get("/{simulation_id}/status")
async def get_status(simulation_id: str) -> dict:
    """Legacy compatibility endpoint. Get legacy simulation status by simulation_id."""
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    runner = OASISRunner(data_dir=data_dir)
    status = await runner.get_status(simulation_id)
    return {
        "simulation_id": simulation_id,
        "status": status.status,
        "current_round": status.current_round,
        "total_rounds": status.total_rounds,
        "recent_actions": status.recent_actions,
    }


# ── MiroFish Integration ──────────────────────────────────────────────────────

@router.get("/runs/{run_id}/detail")
async def get_run_detail(run_id: str) -> dict:
    """Get detailed simulation run information including actions"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")

    # Load action details
    data_dir = _simulation_data_dir()
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    actions = []
    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    action = json.loads(line)
                    agent_meta = _agent_display(str(action.get("agent_id", "")), str(action.get("agent_name", "")))
                    action["agent_name"] = agent_meta["display_name"]
                    action["agent_role"] = agent_meta["role"]
                    action["platform_name"] = agent_meta["platform_name"]
                    actions.append(action)

    if not actions and sim_id:
        oasis_status = await _RUNNER.get_status(sim_id)
        actions = list(oasis_status.recent_actions or [])
        for action in actions:
            agent_meta = _agent_display(str(action.get("agent_id", "")), str(action.get("agent_name", "")))
            action["agent_name"] = agent_meta["display_name"]
            action["agent_role"] = agent_meta["role"]
            action["platform_name"] = agent_meta["platform_name"]

    return {
        **run,
        "all_actions": actions[-100:],  # Last 100 — key matches SimulationStreamPanel expectation
    }


@router.post("/runs/{run_id}/start")
async def start_run(run_id: str) -> dict:
    """Start a created simulation run"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    if run["status"] not in {"created", "paused", "failed"}:
        raise HTTPException(status_code=400, detail="Run already started")

    previous_status = run["status"]
    if previous_status in {"paused", "failed"}:
        run["rounds_completed"] = 0
        run["convergence_achieved"] = False
        run["final_states"] = []
        run["duration_ms"] = None
        run["started_at"] = None
        run.pop("error", None)

    run_config = run.get("run_config") or {}
    req = SimulationCreateRequest(
        name=run_config["name"] if "name" in run_config else run.get("scenario", "未来预测"),
        seed_content=run_config["seed_content"] if "seed_content" in run_config else run.get("seed_content", ""),
        simulation_requirement=run_config["simulation_requirement"] if "simulation_requirement" in run_config else run.get("simulation_requirement", ""),
        max_rounds=run_config["max_rounds"] if "max_rounds" in run_config else run.get("max_rounds", settings.simulation_rounds),
        enable_twitter=run_config["enable_twitter"] if "enable_twitter" in run_config else True,
        enable_reddit=run_config["enable_reddit"] if "enable_reddit" in run_config else True,
    )
    run["stop_requested"] = False
    _CREATE_TASK(_run_simulation_bg(run_id, run["simulation_id"], req))
    run["status"] = "running"
    return run


@router.post("/runs/{run_id}/stop")
async def stop_run(run_id: str) -> dict:
    """Stop a running simulation run"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    if run.get("status") != "running":
        return run

    sim_id = run.get("simulation_id")
    run["stop_requested"] = True
    await _RUNNER.stop(sim_id)
    run["status"] = "paused"
    return run


@router.get("/runs/{run_id}/status")
async def get_run_status(run_id: str) -> dict:
    """
    Get simulation run status — 格式与前端 SimRunStatus 接口对齐。
    返回 twitter/reddit 各自轮次和动作计数，前端 SimulationStreamPanel 轮询此接口。
    """
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    if run.get("status") == "created":
        return {
            "simulation_id": sim_id,
            "status": "created",
            "current_round": 0,
            "total_rounds": run.get("max_rounds", settings.simulation_rounds),
            "twitter_current_round": 0,
            "reddit_current_round": 0,
            "twitter_actions_count": 0,
            "reddit_actions_count": 0,
            "twitter_completed": False,
            "reddit_completed": False,
            "recent_actions": [],
            "is_mock": True,
            "eta_seconds": None,
            "estimated_finish_at": None,
        }

    # 从 OASISRunner 获取实时轮次
    data_dir = _simulation_data_dir()
    oasis_status = await _RUNNER.get_status(sim_id)

    # 更新 registry 中的进度，但不要覆盖显式暂停或刚恢复后的运行态
    run["rounds_completed"] = oasis_status.current_round
    if run.get("stop_requested"):
        effective_status = "paused"
    elif run.get("status") == "running" and oasis_status.status in {"idle", "unknown", "paused"}:
        effective_status = "running"
    else:
        effective_status = oasis_status.status
    run["status"] = effective_status

    run_config = run.get("run_config") or {}
    twitter_enabled = run_config.get("enable_twitter", True)
    reddit_enabled = run_config.get("enable_reddit", True)

    # Read actions.jsonl for per-platform stats and recent_actions
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")
    tw_actions = 0
    rd_actions = 0
    tw_max_round = 0
    rd_max_round = 0
    recent_actions = []

    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            lines = f.readlines()
        for line in lines:
            if line.strip():
                try:
                    a = json.loads(line)
                    if a.get("platform") == "twitter":
                        tw_actions += 1
                        tw_max_round = max(tw_max_round, a.get("round_num", 0))
                    else:
                        rd_actions += 1
                        rd_max_round = max(rd_max_round, a.get("round_num", 0))
                except Exception:
                    pass
        # Extract meaningful recent_actions from last 20 lines of actions.jsonl
        for line in lines[-20:]:
            if line.strip():
                try:
                    a = json.loads(line)
                    desc = ""
                    args = a.get("action_args", {})
                    if args.get("content"):
                        desc = str(args["content"])[:80]
                    elif args.get("text"):
                        desc = str(args["text"])[:80]
                    elif args.get("target_user"):
                        desc = f"@{args['target_user']}"
                    elif args.get("post_id"):
                        desc = f"[post {args['post_id']}]"
                    if desc:
                        agent_meta = _agent_display(str(a.get("agent_id", "")), str(a.get("agent_name", "")))
                        recent_actions.append({
                            "description": desc,
                            "agent": agent_meta["display_name"],
                            "platform": a.get("platform", ""),
                            "action_type": a.get("action_type", ""),
                        })
                except Exception:
                    pass

    total = oasis_status.total_rounds
    current_round = max(oasis_status.current_round, 0)
    tw_current_round = total if not twitter_enabled else min(current_round, total)
    rd_current_round = total if not reddit_enabled else min(current_round, total)
    tw_completed = True if not twitter_enabled else effective_status == "completed" or tw_current_round >= total
    rd_completed = True if not reddit_enabled else effective_status == "completed" or rd_current_round >= total
    eta_seconds = None
    estimated_finish_at = None
    started_at = run.get("started_at")
    if effective_status == "running" and started_at and current_round > 0:
        try:
            elapsed = (datetime.now(UTC) - datetime.fromisoformat(started_at)).total_seconds()
            avg_per_round = elapsed / current_round if current_round else 0
            remaining_rounds = max(total - current_round, 0)
            eta_seconds = int(max(avg_per_round * remaining_rounds, 0))
            estimated_finish_at = (datetime.now(UTC) + timedelta(seconds=eta_seconds)).isoformat()
        except Exception:
            eta_seconds = None
            estimated_finish_at = None

    return {
        "simulation_id": sim_id,
        "status": effective_status,
        "current_round": oasis_status.current_round,
        "total_rounds": total,
        "twitter_current_round": tw_current_round,
        "reddit_current_round": rd_current_round,
        "twitter_actions_count": tw_actions,
        "reddit_actions_count": rd_actions,
        "twitter_completed": tw_completed,
        "reddit_completed": rd_completed,
        "recent_actions": recent_actions if recent_actions else oasis_status.recent_actions,
        "is_mock": getattr(oasis_status, "is_mock", False),
        "eta_seconds": eta_seconds,
        "estimated_finish_at": estimated_finish_at,
    }


# ── Profiles ─────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/profiles")
async def get_run_profiles(run_id: str) -> dict:
    """Get agent profiles for a simulation run"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    profiles: List[dict] = []
    seen = set()

    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        a = json.loads(line)
                        aid = a.get("agent_id", "")
                        if aid and aid not in seen:
                            seen.add(aid)
                            profiles.append({
                                "agent_id": aid,
                                "name": a.get("agent_name", f"Agent_{aid[:6]}"),
                                "platform": a.get("platform", "twitter"),
                                "bio": f"Simulation agent for {run.get('scenario', 'scenario')}",
                                "followers": 100 + len(seen) * 23,
                                "following": 50 + len(seen) * 7,
                                "posts_count": sum(1 for p in seen),
                                "credibility_score": round(0.4 + len(seen) * 0.05, 3),
                                "influence_score": round(0.3 + len(seen) * 0.07, 3),
                                "stance": ["support", "oppose", "neutral"][len(seen) % 3],
                                "round_joined": a.get("round_num", 1),
                            })
                    except Exception:
                        pass

    return {"run_id": run_id, "profiles": profiles, "count": len(profiles)}


# ── Actions (paginated) ──────────────────────────────────────────────────────

@router.get("/runs/{run_id}/actions")
async def get_run_actions(
    run_id: str,
    platform: Optional[str] = None,
    agent_id: Optional[str] = None,
    round_num: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    """Get paginated action list with filters"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    all_actions: List[dict] = []
    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        all_actions.append(json.loads(line))
                    except Exception:
                        pass

    # Apply filters
    if platform:
        all_actions = [a for a in all_actions if a.get("platform") == platform]
    if agent_id:
        all_actions = [a for a in all_actions if a.get("agent_id") == agent_id]
    if round_num is not None:
        all_actions = [a for a in all_actions if a.get("round_num") == round_num]

    total = len(all_actions)
    page = all_actions[offset:offset + limit]

    return {
        "run_id": run_id,
        "actions": page,
        "total": total,
        "limit": limit,
        "offset": offset,
        "platform": platform or "all",
    }


# ── Timeline ─────────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/timeline")
async def get_run_timeline(run_id: str) -> dict:
    """Get round-by-round timeline summary"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    rounds: Dict[int, dict] = {}
    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        a = json.loads(line)
                        rnum = a.get("round_num", 0)
                        plat = a.get("platform", "twitter")
                        key = (rnum, plat)
                        if key not in rounds:
                            rounds[key] = {
                                "round_num": rnum,
                                "platform": plat,
                                "active_agents": set(),
                                "total_actions": 0,
                                "action_types": {},
                                "key_events": [],
                            }
                        rd = rounds[key]
                        rd["active_agents"].add(a.get("agent_id", ""))
                        rd["total_actions"] += 1
                        at = a.get("action_type", "unknown")
                        rd["action_types"][at] = rd["action_types"].get(at, 0) + 1
                        if at in ("post", "tweet") and len(rd["key_events"]) < 3:
                            content = str(a.get("action_args", {}).get("content", ""))[:100]
                            if content:
                                rd["key_events"].append(content)
                    except Exception:
                        pass

    summaries = []
    for (rnum, plat), rd in sorted(rounds.items()):
        dominant = max(rd["action_types"], key=rd["action_types"].get) if rd["action_types"] else ""
        summaries.append(RoundSummary(
            round_num=rnum,
            platform=plat,
            active_agents=len(rd["active_agents"]),
            total_actions=rd["total_actions"],
            dominant_action_type=dominant,
            avg_sentiment=0.5,
            key_events=rd["key_events"],
        ).model_dump())

    return {"run_id": run_id, "timeline": summaries, "count": len(summaries)}


# ── Agent Stats ───────────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/agent-stats")
async def get_run_agent_stats(run_id: str) -> dict:
    """Get per-agent statistics"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    stats: Dict[str, dict] = {}
    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        a = json.loads(line)
                        aid = a.get("agent_id", "")
                        if not aid:
                            continue
                        if aid not in stats:
                            stats[aid] = {
                                "agent_id": aid,
                                "agent_name": a.get("agent_name", f"Agent_{aid[:6]}"),
                                "platform": a.get("platform", "twitter"),
                                "total_actions": 0,
                                "actions_by_type": {},
                                "sentiment_sum": 0.0,
                                "sentiment_count": 0,
                            }
                        s = stats[aid]
                        s["total_actions"] += 1
                        at = a.get("action_type", "unknown")
                        s["actions_by_type"][at] = s["actions_by_type"].get(at, 0) + 1
                        sent = a.get("action_args", {}).get("sentiment", 0.5)
                        s["sentiment_sum"] += float(sent)
                        s["sentiment_count"] += 1
                    except Exception:
                        pass

    result = []
    for aid, s in stats.items():
        final_state = next(
            (fs for fs in run.get("final_states", []) if fs.get("id") == aid),
            None
        )
        belief = final_state.get("belief", 0.5) if final_state else 0.5
        result.append(AgentStats(
            agent_id=aid,
            agent_name=s["agent_name"],
            platform=s["platform"],
            total_actions=s["total_actions"],
            actions_by_type=s["actions_by_type"],
            avg_sentiment=round(s["sentiment_sum"] / s["sentiment_count"], 4) if s["sentiment_count"] else 0.5,
            engagement_rate=round(s["total_actions"] * 0.12, 4),
            influence_score=round(0.2 + s["total_actions"] * 0.03, 4),
            belief_drift=round(abs(belief - 0.5) * 0.5, 4),
            final_belief=round(belief, 4),
        ).model_dump())

    return {"run_id": run_id, "stats": result, "count": len(result)}


# ── Interview ────────────────────────────────────────────────────────────────

@router.post("/runs/{run_id}/interview")
async def interview_agent(run_id: str, req: InterviewRequest) -> dict:
    """Interview a single agent via SimulationRunner (IPC or LLM)"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")
    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    try:
        aid = req.agent_id
        result = SimulationRunner.interview_agent(
            simulation_id=sim_id,
            agent_id=int(aid) if str(aid).isdigit() else aid,
            prompt=req.question,
            platform=req.platform if req.platform not in ("both", None, "") else None,
        )
        return {
            "run_id": run_id,
            "agent_id": req.agent_id,
            "platform": req.platform,
            "question": req.question,
            "response": result.get("result") or result.get("error") or "",
            "success": result.get("success", False),
            "timestamp": datetime.now(UTC).isoformat(),
        }
    except Exception as e:
        return {
            "run_id": run_id,
            "agent_id": req.agent_id,
            "platform": req.platform,
            "question": req.question,
            "response": f"[Interview error: {e}]",
            "success": False,
            "timestamp": datetime.now(UTC).isoformat(),
        }
@router.post("/runs/{run_id}/interviews")
async def batch_interview(run_id: str, req: BatchInterviewRequest) -> dict:
    """Batch interview multiple agents via SimulationRunner"""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")
    run = _run_registry[run_id]
    sim_id = run.get("simulation_id")
    interviews = [{"agent_id": aid, "prompt": req.question} for aid in req.agent_ids]
    try:
        result = SimulationRunner.interview_agents_batch(
            simulation_id=sim_id,
            interviews=interviews,
            platform=req.platform if req.platform not in ("both", None, "") else None,
        )
        return {
            "run_id": run_id,
            "responses": result.get("responses", []),
            "count": result.get("interviews_count", len(interviews)),
            "success": result.get("success", False),
        }
    except Exception as e:
        return {"run_id": run_id, "responses": [], "count": 0, "error": str(e)}

# ── Knowledge Graph ───────────────────────────────────────────────────────────

@router.get("/runs/{run_id}/graph")
async def get_run_graph(run_id: str) -> dict:
    """Get knowledge graph data for a run (nodes + edges)."""
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    graph_metadata = _refresh_run_graph_metadata(run)
    run.update(graph_metadata)
    sim_id = run.get("simulation_id")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    nodes: List[GraphNode] = []
    edges: List[GraphEdge] = []
    seen_nodes: Set[str] = set()
    seen_edges: Set[Tuple[str, str, str]] = set()
    graph_id = str(run.get("graph_id") or "")

    if graph_id:
        try:
            from backend.graph import GraphBuilder as RemoteGraphBuilder

            remote_graph = RemoteGraphBuilder().get_graph_data(graph_id)
            remote_nodes, remote_edges = _convert_remote_graph_data(remote_graph)
            if remote_nodes:
                nodes.extend(remote_nodes)
                seen_nodes.update(node.id for node in remote_nodes)
            if remote_edges:
                edges.extend(remote_edges)
                seen_edges.update((edge.source, edge.target, edge.type) for edge in remote_edges)
        except Exception:
            pass

    seed_content = _normalize_text(run.get("seed_content", ""))
    requirement = _normalize_text(run.get("simulation_requirement", ""))
    scenario_name = _normalize_text(run.get("scenario", "")) or "未来议题"
    topic_node_id = f"topic::{run_id}"
    requirement_node_id = f"goal::{run_id}"

    _append_node(
        nodes,
        seen_nodes,
        topic_node_id,
        scenario_name,
        "Event",
        summary=seed_content[:260],
        status=run.get("status", "created"),
        source="simulation",
    )
    if requirement:
        _append_node(
            nodes,
            seen_nodes,
            requirement_node_id,
            "预测目标",
            "Goal",
            requirement=requirement,
            source="simulation",
        )
        _append_edge(edges, seen_edges, topic_node_id, requirement_node_id, "focuses_on", "预测目标", 0.95, requirement)

    for platform_id, platform_name in (("platform::twitter", "信息广场"), ("platform::reddit", "话题社区")):
        _append_node(nodes, seen_nodes, platform_id, platform_name, "Platform")
        _append_edge(edges, seen_edges, topic_node_id, platform_id, "spreads_on", "演化发生在此", 0.78)

    seed_entities = _extract_seed_entities(" ".join(part for part in [scenario_name, seed_content, requirement] if part))
    for entity in seed_entities:
        node_id = f"entity::{entity['name']}"
        _append_node(nodes, seen_nodes, node_id, entity["name"], entity["type"])
        label = "关键参与方" if entity["type"] == "Actor" else "关键区域" if entity["type"] == "Region" else "核心议题"
        _append_edge(edges, seen_edges, topic_node_id, node_id, "relates_to", label, 0.86, f"{scenario_name} 与 {entity['name']} 直接相关")
        if entity["type"] in {"Actor", "Concept"}:
            _append_edge(edges, seen_edges, node_id, "platform::twitter", "appears_on", "在信息广场发酵", 0.58)
        if entity["type"] in {"Actor", "Region", "Concept"}:
            _append_edge(edges, seen_edges, node_id, "platform::reddit", "appears_on", "在话题社区扩散", 0.52)

    final_states = run.get("final_states", [])
    agent_activity: Dict[str, Dict[str, Any]] = {}
    for fs in final_states:
        nid = fs.get("id", "")
        if not nid:
            continue
        belief = float(fs.get("belief", 0.5))
        influence = float(fs.get("influence", 0.5))
        agent_meta = _agent_display(nid)
        agent_activity[nid] = {
            "belief": belief,
            "influence": influence,
            "actions": fs.get("actions", 0),
            "platform": agent_meta["platform"],
        }
        _append_node(
            nodes,
            seen_nodes,
            nid,
            agent_meta["display_name"],
            "Agent",
            belief=belief,
            influence=influence,
            actions=fs.get("actions", 0),
            platform=agent_meta["platform_name"],
            role=agent_meta["role"],
            summary=agent_meta["summary"],
        )
        _append_edge(edges, seen_edges, nid, topic_node_id, "observes", _RELATION_LABELS["observes"], 0.7, f"{agent_meta['display_name']} 正在围绕该议题采取行动")
        if agent_meta["platform"] == "twitter":
            _append_edge(edges, seen_edges, nid, "platform::twitter", "active_on", _RELATION_LABELS["active_on"], 0.72)
        elif agent_meta["platform"] == "reddit":
            _append_edge(edges, seen_edges, nid, "platform::reddit", "active_on", _RELATION_LABELS["active_on"], 0.72)

    if os.path.exists(actions_file):
        mentions: Dict[Tuple[str, str], int] = {}
        entity_mentions: Dict[Tuple[str, str], int] = {}
        topical_clusters: Dict[str, Dict[str, Any]] = {}
        recent_actions: List[dict] = []
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        action = json.loads(line)
                        recent_actions.append(action)
                        src = str(action.get("agent_id", ""))
                        args = action.get("action_args", {}) or {}
                        target = str(args.get("target_user", ""))
                        content = _normalize_text(str(args.get("content") or args.get("text") or ""))
                        platform = str(action.get("platform", "twitter"))
                        agent_meta = _agent_display(src, str(action.get("agent_name", "")))
                        if src:
                            platform_node = "platform::twitter" if platform == "twitter" else "platform::reddit"
                            _append_node(
                                nodes,
                                seen_nodes,
                                src,
                                agent_meta["display_name"],
                                "Agent",
                                platform=agent_meta["platform_name"],
                                role=agent_meta["role"],
                                summary=agent_meta["summary"],
                            )
                            _append_edge(edges, seen_edges, src, platform_node, "active_on", _RELATION_LABELS["active_on"], 0.72)
                        if src and target and src != target:
                            key = (src, target)
                            mentions[key] = mentions.get(key, 0) + 1
                        if src and content:
                            for entity in seed_entities:
                                if entity["name"] in content:
                                    key = (src, entity["name"])
                                    entity_mentions[key] = entity_mentions.get(key, 0) + 1
                        for topic_name in _extract_action_topics(action):
                            cluster = topical_clusters.setdefault(
                                topic_name,
                                {"count": 0, "agents": set(), "platforms": set(), "last_round": 0},
                            )
                            cluster["count"] = int(cluster["count"]) + 1
                            if src:
                                cast_agents = cluster["agents"]
                                if isinstance(cast_agents, set):
                                    cast_agents.add(src)
                            cast_platforms = cluster["platforms"]
                            if isinstance(cast_platforms, set):
                                cast_platforms.add(platform)
                            cluster["last_round"] = max(int(cluster["last_round"]), int(action.get("round_num", 0)))
                    except Exception:
                        pass

        recent_actions = recent_actions[-18:]

        ranked_topics = sorted(
            topical_clusters.items(),
            key=lambda item: (int(item[1]["count"]), int(item[1]["last_round"])),
            reverse=True,
        )[:8]

        for topic_name, meta in ranked_topics:
            topic_cluster_id = f"concept::{topic_name}"
            _append_node(
                nodes,
                seen_nodes,
                topic_cluster_id,
                topic_name,
                "Concept",
                occurrences=int(meta["count"]),
                summary=f"该话题在预测过程中被提及 {int(meta['count'])} 次。",
            )
            _append_edge(
                edges,
                seen_edges,
                topic_node_id,
                topic_cluster_id,
                "drives",
                _RELATION_LABELS["drives"],
                min(0.55 + int(meta["count"]) / 10.0, 1.0),
                f"“{topic_name}”是当前未来预测中的高频议题焦点",
            )
            _append_edge(
                edges,
                seen_edges,
                topic_cluster_id,
                topic_node_id,
                "signals",
                _RELATION_LABELS["signals"],
                min(0.45 + int(meta["count"]) / 12.0, 0.92),
                f"“{topic_name}”持续升温，正在对整体未来路径释放新的风险信号",
            )
            for platform in sorted(meta["platforms"]):
                platform_node = "platform::twitter" if platform == "twitter" else "platform::reddit"
                _append_edge(
                    edges,
                    seen_edges,
                    topic_cluster_id,
                    platform_node,
                    "appears_on",
                    _RELATION_LABELS["appears_on"],
                    0.66,
                    f"“{topic_name}”在该平台持续升温",
                )
            for agent_id in list(meta["agents"])[:5]:
                agent_meta = _agent_display(agent_id)
                _append_node(
                    nodes,
                    seen_nodes,
                    agent_id,
                    agent_meta["display_name"],
                    "Agent",
                    platform=agent_meta["platform_name"],
                    role=agent_meta["role"],
                    summary=agent_meta["summary"],
                )
                _append_edge(
                    edges,
                    seen_edges,
                    agent_id,
                    topic_cluster_id,
                    "discusses",
                    _RELATION_LABELS["discusses"],
                    0.78,
                    f"{agent_meta['display_name']} 正在围绕“{topic_name}”输出观点或互动",
                )

        for (src, target), count in mentions.items():
            src_meta = _agent_display(src)
            target_meta = _agent_display(target)
            _append_node(nodes, seen_nodes, src, src_meta["display_name"], "Agent", platform=src_meta["platform_name"], role=src_meta["role"], summary=src_meta["summary"])
            _append_node(nodes, seen_nodes, target, target_meta["display_name"], "Agent", platform=target_meta["platform_name"], role=target_meta["role"], summary=target_meta["summary"])
            _append_edge(
                edges,
                seen_edges,
                src,
                target,
                "interacts_with",
                f"互动 {count} 次",
                min(0.35 + count / 8.0, 1.0),
                f"{src_meta['display_name']} 与 {target_meta['display_name']} 在预测过程中发生 {count} 次互动",
            )

        for (src, entity_name), count in entity_mentions.items():
            entity_id = f"entity::{entity_name}"
            src_meta = _agent_display(src)
            _append_node(nodes, seen_nodes, src, src_meta["display_name"], "Agent", platform=src_meta["platform_name"], role=src_meta["role"], summary=src_meta["summary"])
            _append_node(nodes, seen_nodes, entity_id, entity_name, "Concept")
            _append_edge(
                edges,
                seen_edges,
                src,
                entity_id,
                "discusses",
                f"关注 {entity_name}",
                min(0.25 + count / 6.0, 0.95),
                f"{src_meta['display_name']} 在内容中多次提及 {entity_name}",
            )

        for index, action in enumerate(recent_actions):
            src = str(action.get("agent_id", ""))
            src_meta = _agent_display(src, str(action.get("agent_name", "")))
            args = action.get("action_args", {}) or {}
            platform = str(action.get("platform", "twitter"))
            action_id = f"action::{index}::{action.get('timestamp', '')}"
            round_num = int(action.get("round_num", 0))
            preview = _preview_action(args)
            action_title = _humanize_action_title(str(action.get("action_type", "")), platform, args)
            platform_node = "platform::twitter" if platform == "twitter" else "platform::reddit"
            _append_node(
                nodes,
                seen_nodes,
                action_id,
                action_title,
                "Action",
                platform=platform,
                round=round_num,
                action_type=str(action.get("action_type", "")),
                timestamp=str(action.get("timestamp", "")),
                summary=preview,
                display_title=action_title,
            )
            if src:
                _append_node(nodes, seen_nodes, src, src_meta["display_name"], "Agent", platform=src_meta["platform_name"], role=src_meta["role"], summary=src_meta["summary"])
                _append_edge(edges, seen_edges, src, action_id, "initiates", f"第 {round_num} 轮动作", 0.92, f"{src_meta['display_name']} 在第 {round_num} 轮发起动作：{preview}")
            _append_edge(edges, seen_edges, action_id, platform_node, "published_on", _RELATION_LABELS["published_on"], 0.72, f"{action_title} 已在该平台留下痕迹：{preview}")

            target_user = str(args.get("target_user", ""))
            if target_user:
                target_id = target_user if target_user.startswith("agent_") else f"agent::{target_user}"
                target_meta = _agent_display(target_id, target_user)
                _append_node(nodes, seen_nodes, target_id, target_meta["display_name"], "Agent", platform=target_meta["platform_name"], role=target_meta["role"], summary=target_meta["summary"])
                _append_edge(edges, seen_edges, action_id, target_id, "targets", _RELATION_LABELS["targets"], 0.76, preview)
                if src:
                    _append_edge(edges, seen_edges, src, target_id, "responds_to", _RELATION_LABELS["responds_to"], 0.68, f"{src_meta['display_name']} 正在直接回应 {target_meta['display_name']}")

            linked = False
            for entity in seed_entities:
                if entity["name"] in preview:
                    entity_id = f"entity::{entity['name']}"
                    _append_node(nodes, seen_nodes, entity_id, entity["name"], entity["type"])
                    _append_edge(edges, seen_edges, action_id, entity_id, "references", f"提及 {entity['name']}", 0.74, f"{action_title} 明确提及 {entity['name']}：{preview}")
                    linked = True
            for topic_name in _extract_action_topics(action):
                topic_cluster_id = f"concept::{topic_name}"
                _append_node(nodes, seen_nodes, topic_cluster_id, topic_name, "Concept")
                _append_edge(edges, seen_edges, action_id, topic_cluster_id, "references", f"围绕 {topic_name}", 0.71, f"{action_title} 正围绕“{topic_name}”展开：{preview}")
                _append_edge(edges, seen_edges, platform_node, topic_cluster_id, "amplifies", _RELATION_LABELS["amplifies"], 0.62, f"{'信息广场' if platform == 'twitter' else '话题社区'} 正在放大“{topic_name}”")
                linked = True
            if not linked:
                _append_edge(edges, seen_edges, action_id, topic_node_id, "contributes_to", _RELATION_LABELS["contributes_to"], 0.64, f"{action_title} 正在推动整体未来路径变化：{preview}")

    agent_nodes = [node for node in nodes if node.type == "Agent"]
    for index, first in enumerate(agent_nodes):
        belief1 = _safe_number(first.properties.get("belief"), 0.5)
        for second in agent_nodes[index + 1:]:
            belief2 = _safe_number(second.properties.get("belief"), 0.5)
            diff = abs(belief1 - belief2)
            if diff < 0.18:
                _append_edge(
                    edges,
                    seen_edges,
                    first.id,
                    second.id,
                    "stance_similarity",
                    f"立场接近 {int((1 - diff) * 100)}%",
                    round(1 - diff, 3),
                    f"{first.name} 与 {second.name} 对议题的预测倾向较接近",
                )

    seed_actor_nodes = [node for node in nodes if node.type in {"Actor", "Region", "Concept"}]
    for index, first in enumerate(seed_actor_nodes):
        for second in seed_actor_nodes[index + 1:]:
            if first.name == second.name:
                continue
            if first.type == second.type or {first.type, second.type} <= {"Actor", "Region", "Concept"}:
                _append_edge(
                    edges,
                    seen_edges,
                    first.id,
                    second.id,
                    "co_occurs_with",
                    _RELATION_LABELS["co_occurs_with"],
                    0.42,
                    f"{first.name} 与 {second.name} 在同一未来议题中反复共同出现",
                )

    node_name_map = {node.id: node.name for node in nodes}
    enriched_edges = [
        edge.model_copy(
            update={
                "source_node_name": edge.source_node_name or node_name_map.get(str(edge.source), ""),
                "target_node_name": edge.target_node_name or node_name_map.get(str(edge.target), ""),
                "source_node_uuid": edge.source_node_uuid or str(edge.source),
                "target_node_uuid": edge.target_node_uuid or str(edge.target),
            }
        )
        for edge in edges
    ]
    derived_entity_types = sorted({node.type for node in nodes if node.type})
    response_metadata = {
        **graph_metadata,
        "node_count": len(nodes),
        "edge_count": len(enriched_edges),
        "graph_entity_count": max(int(graph_metadata.get("graph_entity_count") or 0), len(nodes)),
        "graph_relation_count": max(int(graph_metadata.get("graph_relation_count") or 0), len(enriched_edges)),
        "graph_entity_types": graph_metadata.get("graph_entity_types") or derived_entity_types,
    }
    run.update(response_metadata)

    return {
        **response_metadata,
        **KGData(nodes=nodes, edges=enriched_edges).model_dump(),
    }


# ── Legacy prepare compatibility endpoint ───────────────────────────────────

@router.post("/prepare")
async def prepare_run(req: SimulationCreateRequest) -> dict:
    """Legacy compatibility endpoint. Prepare a legacy simulation configuration."""
    sim_id = f"sim_{uuid.uuid4().hex[:12]}"
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    sim_dir = os.path.join(data_dir, sim_id)
    os.makedirs(sim_dir, exist_ok=True)

    config_path = os.path.join(sim_dir, "simulation_config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump({
            "simulation_id": sim_id,
            "name": req.name,
            "seed_content": req.seed_content,
            "simulation_requirement": req.simulation_requirement,
            "max_rounds": req.max_rounds,
            "enable_twitter": req.enable_twitter,
            "enable_reddit": req.enable_reddit,
        }, f, ensure_ascii=False)

    return {
        "simulation_id": sim_id,
        "config_path": config_path,
        "status": "ready",
    }


# ── Report ───────────────────────────────────────────────────────────────────

@router.get("/report/{run_id}")
async def get_simulation_report(run_id: str) -> dict:
    """
    Generate and return HTML report for a simulation run.
    Frontend ReportViewer expects { html_content: string }.
    """
    if run_id not in _run_registry:
        raise HTTPException(status_code=404, detail="Run not found")

    run = _run_registry[run_id]
    sim_id = run.get("simulation_id", "")
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "simulations")
    actions_file = os.path.join(data_dir, sim_id, "actions.jsonl")

    # Collect stats from actions.jsonl
    tw_count = rd_count = tw_max = rd_max = 0
    action_types: Dict[str, int] = {}
    agents: List[str] = []
    seen_agents = set()
    recent_events: list[str] = []

    if os.path.exists(actions_file):
        with open(actions_file, encoding='utf-8') as f:
            for line in f:
                if line.strip():
                    try:
                        a = json.loads(line)
                        plat = a.get("platform", "twitter")
                        rnum = a.get("round_num", 0)
                        at = a.get("action_type", "unknown")
                        action_types[at] = action_types.get(at, 0) + 1
                        if plat == "twitter":
                            tw_count += 1
                            tw_max = max(tw_max, rnum)
                        else:
                            rd_count += 1
                            rd_max = max(rd_max, rnum)
                        aid = a.get("agent_id", "")
                        if aid and aid not in seen_agents:
                            seen_agents.add(aid)
                            agents.append(aid)
                        content = str(a.get("action_args", {}).get("content", ""))[:120]
                        if content and len(recent_events) < 8:
                            recent_events.append(content)
                    except Exception:
                        pass

    total_actions = tw_count + rd_count
    seed = run.get("scenario", "未来议题")
    status = run.get("status", "unknown")
    final_states = run.get("final_states", [])

    safe_run_id = escape(str(run_id))
    safe_status = escape(str(status))
    safe_seed = escape(str(seed))
    safe_generated_at = escape(datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC'))
    action_rows_html = "".join(
        f"<tr><td>{escape(str(at))}</td><td>{cnt}</td><td>{cnt * 100 / max(total_actions, 1):.1f}%</td></tr>"
        for at, cnt in sorted(action_types.items(), key=lambda x: -x[1])
    )
    recent_events_html = "".join(
        f"<div class='event'>📌 {escape(str(ev))}</div>"
        for ev in recent_events
    )

    # Compute high-risk agents
    high_risk = [fs for fs in final_states if fs.get("belief", 0) > 0.65]
    low_risk = [fs for fs in final_states if fs.get("belief", 0) < 0.35]

    # Build HTML report
    html_content = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>
  :root {{ color-scheme: light; }}
  body {{ font-family: 'IBM Plex Sans', -apple-system, sans-serif; max-width: 980px; margin: 28px auto; padding: 0 20px 48px; color: #1a2332; line-height: 1.75; background: #f8fbff; }}
  .shell {{ background: rgba(255,255,255,0.94); border: 1px solid #dbe7f3; border-radius: 24px; overflow: hidden; box-shadow: 0 24px 80px rgba(15, 23, 42, 0.08); }}
  .hero {{ padding: 32px; background: linear-gradient(135deg, rgba(37,99,235,0.12), rgba(14,165,233,0.08), rgba(16,185,129,0.08)); border-bottom: 1px solid #dbe7f3; }}
  h1 {{ color: #102a56; margin: 0 0 10px; font-size: 2rem; letter-spacing: -0.03em; }}
  h2 {{ color: #163b75; margin-top: 2em; font-size: 1.18rem; letter-spacing: -0.01em; }}
  .meta {{ color: #64748b; font-size: 0.85rem; margin-bottom: 1.2em; }}
  .summary {{ max-width: 760px; font-size: 0.96rem; color: #334155; }}
  .content {{ padding: 28px 32px 36px; }}
  .stats {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 22px 0 10px; }}
  .stat {{ background: linear-gradient(180deg, #ffffff, #f5f9ff); border: 1px solid #e2e8f0; border-radius: 18px; padding: 16px; text-align: center; }}
  .stat-val {{ font-size: 1.85rem; font-weight: 800; color: #2563eb; }}
  .stat-lbl {{ font-size: 0.72rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 6px; }}
  .event {{ background: #fff; border: 1px solid #e2e8f0; border-left: 4px solid #2563eb; padding: 10px 14px; margin: 8px 0; border-radius: 14px; font-size: 0.9rem; color: #334155; }}
  .high {{ color: #dc2626; font-weight: 700; }} .low {{ color: #16a34a; font-weight: 700; }}
  table {{ width: 100%; border-collapse: collapse; margin: 1em 0; overflow: hidden; border-radius: 14px; }}
  th {{ background: #f0f6ff; padding: 10px 12px; text-align: left; font-size: 0.8rem; color: #64748b; border-bottom: 1px solid #e2e8f0; }}
  td {{ padding: 10px 12px; font-size: 0.86rem; border-bottom: 1px solid #f1f5f9; background: #fff; }}
  .badge {{ display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 0.72rem; font-weight: 700; }}
  .badge-done {{ background: #dcfce7; color: #16a34a; }} .badge-fail {{ background: #fee2e2; color: #dc2626; }}
  .badge-run {{ background: #dbeafe; color: #2563eb; }}
  .section-card {{ background: #fff; border: 1px solid #e2e8f0; border-radius: 18px; padding: 18px 20px; margin-top: 18px; }}
  .footer-note {{ margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 18px; color: #64748b; font-size: 0.82rem; }}
</style>
</head>
<body>
<div class="shell">
<div class="hero">
<div class="meta">
  记录 ID: <code>{safe_run_id}</code> ·
  当前状态: <span class="badge {'badge-done' if status == 'completed' else 'badge-fail' if status == 'failed' else 'badge-run'}">{safe_status}</span> ·
  生成时间: {safe_generated_at}
</div>
<h1>未来预测报告：{safe_seed}</h1>
<div class="summary">
  这份报告围绕 <strong>{safe_seed}</strong> 汇总未来路径图谱、平台互动轨迹与阶段性判断，
  用于帮助快速理解“谁在影响局势、信息如何扩散、未来 72 小时可能怎样演化”。
</div>
<div class="stats">
  <div class="stat"><div class="stat-val">{len(agents)}</div><div class="stat-lbl">代理体</div></div>
  <div class="stat"><div class="stat-val">{total_actions}</div><div class="stat-lbl">总动作</div></div>
  <div class="stat"><div class="stat-val">{tw_count}</div><div class="stat-lbl">Info Plaza</div></div>
  <div class="stat"><div class="stat-val">{rd_count}</div><div class="stat-lbl">Topic Comm.</div></div>
</div>
 </div>
<div class="content">
<div class="section-card">
<h2>执行摘要</h2>
<p>本轮未来预测围绕议题"<strong>{safe_seed}</strong>"展开，在双平台（Info Plaza / Topic Community）上推进了 <strong>{tw_max}/{rd_max}</strong> 轮，累计出现 <strong>{total_actions}</strong> 个关键动作事件，参与代理体 <strong>{len(agents)}</strong> 个。</p>
<p>系统{"已形成相对稳定的未来走向" if run.get("convergence_achieved") else "仍处于高速演化阶段"}，其中高风险代理体 {len(high_risk)} 个，低风险代理体 {len(low_risk)} 个。</p>
</div>
<div class="section-card">
<h2>背景</h2>
<p>OASIS 预测引擎通过多代理体社交网络演化，对议题在双平台上的未来走势进行推演。Info Plaza（类 Twitter）反映公共广场的舆论扩散，Topic Community（类 Reddit）反映社区内的深度讨论。两平台并行运行，代理体跨平台互动并持续影响未来路径。</p>
</div>
<div class="section-card">
<h2>行为分析</h2>
<p>各类型动作分布：</p>
<table>
<tr><th>动作类型</th><th>次数</th><th>占比</th></tr>
{action_rows_html}
</table>
</div>
<div class="section-card">
<h2>重点事件</h2>
{recent_events_html}
</div>
<div class="section-card">
<h2>预测</h2>
<p>基于当前未来路径结果：</p>
<ul>
  <li>高风险代理体（信念值 &gt; 0.65）数量为 <span class="high">{len(high_risk)}</span>，建议重点关注其影响力扩散路径</li>
  <li>低风险代理体（信念值 &lt; 0.35）数量为 <span class="low">{len(low_risk)}</span>，可能在后续演化中改变立场</li>
  <li>整体系统{"已进入相对稳定区间" if run.get("convergence_achieved") else "仍处于动态演化中"}，未来趋势相对{"更清晰" if run.get("convergence_achieved") else "仍需持续观察"}</li>
</ul>
</div>
<div class="section-card">
<h2>建议</h2>
<ol>
  <li>持续监控高风险代理体的行动模式，特别是在关键决策节点</li>
  <li>利用低风险代理体作为意见领袖的潜在候选人进行引导</li>
  <li>在 Info Plaza 与 Topic Community 之间建立信息桥接，促进理性讨论</li>
  <li>定期重新运行未来预测，跟踪议题演化最新态势</li>
</ol>
</div>
</div>
<div class="footer-note">
  本报告由 OrcaFish 未来预测引擎自动生成 · {total_actions} 个动作事件 · {len(agents)} 个代理体 · {tw_max + rd_max} 轮推演
</div>
</div>
</div>
</body>
</html>"""

    return {"html_content": html_content, "run_id": run_id, "status": status}
