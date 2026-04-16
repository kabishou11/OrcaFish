"""Graph building service — Graphiti-style local Zep CE HTTP integration"""
from __future__ import annotations

import re
import time
import uuid
from datetime import datetime
from typing import Any, Optional

import httpx

from ..config import settings
from .models import GraphInfo
from .snapshot_store import GraphSnapshotStore


class GraphBuilder:
    """通过本地 Zep CE / Graphiti 风格接口构建知识图谱。"""

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        graphiti_base = settings.graphiti_base_url or settings.zep_base_url
        self.base_url = (base_url or graphiti_base).rstrip("/")
        self.api_secret = api_key or settings.zep_api_secret or settings.zep_api_key
        self._mock = not self.base_url

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.api_secret:
            headers["Authorization"] = f"Api-Key {self.api_secret}"
        return headers

    def create_graph(self, name: str) -> str:
        """Graphiti 模式下直接生成 group_id 作为 graph_id。"""
        prefix = "mock_graph" if self._mock else "orcafish"
        return f"{prefix}_{uuid.uuid4().hex[:16]}"

    def _build_snapshot(self, graph_id: str, text_chunks: list[str]) -> dict[str, Any]:
        created_at = datetime.now().isoformat()
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        seen_nodes: set[str] = set()
        seen_edges: set[tuple[str, str, str]] = set()
        entity_types: set[str] = set()

        def add_node(node_id: str, name: str, labels: list[str], summary: str = "", attributes: Optional[dict[str, Any]] = None) -> None:
            if node_id in seen_nodes:
                return
            seen_nodes.add(node_id)
            nodes.append(
                {
                    "uuid": node_id,
                    "name": name,
                    "labels": labels,
                    "summary": summary,
                    "attributes": attributes or {},
                    "created_at": created_at,
                }
            )
            for label in labels:
                if label not in {"Entity", "Node", "Episode"}:
                    entity_types.add(label)

        def add_edge(source: str, target: str, edge_type: str, fact: str, weight: float = 0.84) -> None:
            if source == target:
                return
            edge_key = (source, target, edge_type)
            if edge_key in seen_edges:
                return
            seen_edges.add(edge_key)
            edges.append(
                {
                    "uuid": f"{edge_type}::{source}::{target}",
                    "name": edge_type,
                    "fact": fact,
                    "fact_type": edge_type,
                    "source_node_uuid": source,
                    "target_node_uuid": target,
                    "source_node_name": next((node["name"] for node in nodes if node["uuid"] == source), source),
                    "target_node_name": next((node["name"] for node in nodes if node["uuid"] == target), target),
                    "attributes": {"weight": weight, "source": "snapshot"},
                    "created_at": created_at,
                    "valid_at": created_at,
                    "invalid_at": None,
                    "expired_at": None,
                    "episodes": [],
                }
            )

        topic_id = f"topic::{graph_id}"
        topic_title = self._extract_entities(" ".join(text_chunks[:2]))[:1]
        add_node(
            topic_id,
            topic_title[0] if topic_title else "未来议题",
            ["Event"],
            summary=" ".join(text_chunks)[:260],
            attributes={"source": "snapshot_seed"},
        )

        for index, chunk in enumerate(text_chunks):
            episode_id = f"episode::{graph_id}::{index}"
            entities = self._extract_entities(chunk)
            add_node(
                episode_id,
                self._episode_title(chunk, entities, index),
                ["Episode"],
                summary=chunk[:220],
                attributes={"chunk_index": index + 1, "source": "snapshot_chunk"},
            )
            add_edge(topic_id, episode_id, "contains", "议题包含该原始情报片段", 0.72)
            for entity in entities:
                entity_type = self._classify_entity(entity)
                entity_id = f"entity::{entity}"
                add_node(
                    entity_id,
                    entity,
                    ["Entity", entity_type],
                    summary=f"从种子内容中抽取到的中文实体：{entity}",
                    attributes={"source": "snapshot_entity"},
                )
                add_edge(episode_id, entity_id, "mentions", f"情报片段提及 {entity}", 0.9)
                add_edge(topic_id, entity_id, "relates_to", f"未来议题与 {entity} 直接相关", 0.88)
            for entity_index in range(len(entities)):
                for inner in range(entity_index + 1, len(entities)):
                    add_edge(
                        f"entity::{entities[entity_index]}",
                        f"entity::{entities[inner]}",
                        "co_occurs_with",
                        f"{entities[entity_index]} 与 {entities[inner]} 在同一情报片段共同出现",
                        0.76,
                    )

        return {
            "graph_id": graph_id,
            "nodes": nodes,
            "edges": edges,
            "node_count": len(nodes),
            "edge_count": len(edges),
            "entity_types": sorted(entity_types),
            "source_mode": "snapshot",
        }

    def add_text_batch(self, graph_id: str, text_chunks: list[str]) -> list[str]:
        """通过 /messages 将文本块写入本地图谱。"""
        if self._mock:
            return [f"mock_ep_{i}" for i in range(len(text_chunks))]

        episode_ids: list[str] = []
        messages: list[dict[str, Any]] = []
        timestamp = datetime.now().isoformat()
        for index, chunk in enumerate(text_chunks):
            episode_id = f"ep_{uuid.uuid4().hex[:16]}"
            episode_ids.append(episode_id)
            messages.append(
                {
                    "uuid": episode_id,
                    "name": f"source_chunk_{index + 1}",
                    "role_type": "user",
                    "role": "source_ingest",
                    "content": chunk,
                    "source_description": "orcafish graph build",
                    "timestamp": timestamp,
                }
            )

        try:
            with httpx.Client(timeout=120) as client:
                response = client.post(
                    f"{self.base_url}/messages",
                    headers=self._headers(),
                    json={"group_id": graph_id, "messages": messages},
                )
                response.raise_for_status()
                time.sleep(min(2, max(1, len(messages) // 2 or 1)))
        except Exception:
            pass
        if text_chunks:
            GraphSnapshotStore.save(graph_id, self._build_snapshot(graph_id, text_chunks))
        return episode_ids or [f"ep_{i}" for i in range(len(text_chunks))]

    def wait_for_processing(self, episode_uuids: list[str], timeout: int = 60):
        """Graphiti 写入采用异步队列，这里仅做短暂等待。"""
        if episode_uuids:
            time.sleep(min(3, max(1, len(episode_uuids))))

    def _extract_graph_info_from_episodes(self, graph_id: str, episodes: Any) -> GraphInfo:
        if not isinstance(episodes, list):
            return GraphInfo(graph_id=graph_id, node_count=0, edge_count=0, entity_types=[])

        entity_types = sorted(
            {
                str(label)
                for episode in episodes
                if isinstance(episode, dict)
                for label in (episode.get("labels") or [])
                if isinstance(label, str) and label not in {"Entity", "Node", "Episode"}
            }
        )
        return GraphInfo(
            graph_id=graph_id,
            node_count=len(episodes),
            edge_count=0,
            entity_types=entity_types,
        )

    def _fetch_episodes(self, graph_id: str, last_n: int = 100) -> list[dict[str, Any]]:
        if self._mock:
            return []
        try:
            with httpx.Client(timeout=30) as client:
                response = client.get(
                    f"{self.base_url}/episodes/{graph_id}",
                    headers=self._headers(),
                    params={"last_n": last_n},
                )
                if response.is_success:
                    payload = response.json()
                    if isinstance(payload, list):
                        return [item for item in payload if isinstance(item, dict)]
        except Exception:
            pass
        return []

    def _extract_collection(self, payload: Any, keys: tuple[str, ...]) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if not isinstance(payload, dict):
            return []
        for key in keys:
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
            if isinstance(value, dict):
                nested = self._extract_collection(value, keys)
                if nested:
                    return nested
        return []

    def _fetch_collection_pages(
        self,
        path_candidates: list[str],
        result_keys: tuple[str, ...],
        params: Optional[dict[str, Any]] = None,
        page_size: int = 200,
        max_pages: int = 8,
    ) -> list[dict[str, Any]]:
        if self._mock or not self.base_url:
            return []

        base_params = dict(params or {})
        for path in path_candidates:
            collected: list[dict[str, Any]] = []
            cursor: Optional[str] = None
            succeeded = False
            with httpx.Client(timeout=30) as client:
                for _ in range(max_pages):
                    request_params = {**base_params, "limit": page_size}
                    if cursor:
                        request_params["cursor"] = cursor
                        request_params["uuid_cursor"] = cursor
                    try:
                        response = client.get(
                            f"{self.base_url}{path}",
                            headers=self._headers(),
                            params=request_params,
                        )
                    except Exception:
                        break
                    if not response.is_success:
                        break
                    succeeded = True
                    try:
                        payload = response.json()
                    except Exception:
                        break
                    items = self._extract_collection(payload, result_keys)
                    if not items:
                        break
                    collected.extend(items)
                    if len(items) < page_size:
                        break
                    last_item = items[-1]
                    cursor = str(
                        last_item.get("uuid")
                        or last_item.get("uuid_")
                        or last_item.get("id")
                        or ""
                    ).strip() or None
                    if not cursor:
                        break
            if succeeded and collected:
                return collected
        return []

    def _fetch_graph_nodes(self, graph_id: str) -> list[dict[str, Any]]:
        return self._fetch_collection_pages(
            path_candidates=[
                f"/graphs/{graph_id}/nodes",
                f"/graph/{graph_id}/nodes",
                f"/group/{graph_id}/nodes",
                "/nodes",
            ],
            result_keys=("nodes", "items", "results", "data"),
            params={"graph_id": graph_id, "group_id": graph_id},
        )

    def _fetch_graph_edges(self, graph_id: str) -> list[dict[str, Any]]:
        return self._fetch_collection_pages(
            path_candidates=[
                f"/graphs/{graph_id}/edges",
                f"/graph/{graph_id}/edges",
                f"/group/{graph_id}/edges",
                "/edges",
            ],
            result_keys=("edges", "items", "results", "data"),
            params={"graph_id": graph_id, "group_id": graph_id},
        )

    def _normalize_remote_node(self, raw_node: dict[str, Any]) -> Optional[dict[str, Any]]:
        node_id = str(raw_node.get("uuid") or raw_node.get("uuid_") or raw_node.get("id") or "").strip()
        if not node_id:
            return None
        labels_raw = raw_node.get("labels") or raw_node.get("types") or raw_node.get("label") or []
        if isinstance(labels_raw, str):
            labels = [labels_raw]
        elif isinstance(labels_raw, list):
            labels = [str(label) for label in labels_raw if str(label).strip()]
        else:
            labels = []
        attributes = raw_node.get("attributes")
        if not isinstance(attributes, dict):
            attributes = {}
        summary = str(
            raw_node.get("summary")
            or raw_node.get("fact")
            or raw_node.get("content")
            or attributes.get("summary")
            or attributes.get("content_preview")
            or ""
        ).strip()
        return {
            "uuid": node_id,
            "name": str(raw_node.get("name") or raw_node.get("title") or raw_node.get("label") or node_id).strip(),
            "labels": labels or ["Entity"],
            "summary": summary,
            "attributes": attributes,
            "created_at": raw_node.get("created_at") or raw_node.get("valid_at") or raw_node.get("timestamp"),
        }

    def _normalize_remote_edge(self, raw_edge: dict[str, Any], node_name_map: dict[str, str]) -> Optional[dict[str, Any]]:
        source = str(
            raw_edge.get("source_node_uuid")
            or raw_edge.get("source_uuid")
            or raw_edge.get("source")
            or raw_edge.get("source_id")
            or ""
        ).strip()
        target = str(
            raw_edge.get("target_node_uuid")
            or raw_edge.get("target_uuid")
            or raw_edge.get("target")
            or raw_edge.get("target_id")
            or ""
        ).strip()
        if not source or not target or source == target:
            return None
        edge_type = str(raw_edge.get("fact_type") or raw_edge.get("type") or raw_edge.get("name") or "related_to").strip()
        attributes = raw_edge.get("attributes")
        if not isinstance(attributes, dict):
            attributes = {}
        return {
            "uuid": str(raw_edge.get("uuid") or raw_edge.get("id") or f"{edge_type}::{source}::{target}"),
            "name": str(raw_edge.get("name") or edge_type),
            "fact": str(raw_edge.get("fact") or raw_edge.get("summary") or raw_edge.get("description") or edge_type),
            "fact_type": edge_type,
            "source_node_uuid": source,
            "target_node_uuid": target,
            "source_node_name": str(raw_edge.get("source_node_name") or node_name_map.get(source) or source),
            "target_node_name": str(raw_edge.get("target_node_name") or node_name_map.get(target) or target),
            "attributes": attributes,
            "created_at": raw_edge.get("created_at") or raw_edge.get("timestamp"),
            "valid_at": raw_edge.get("valid_at"),
            "invalid_at": raw_edge.get("invalid_at"),
            "expired_at": raw_edge.get("expired_at"),
            "episodes": raw_edge.get("episodes") if isinstance(raw_edge.get("episodes"), list) else [],
        }

    def _graph_data_from_nodes_and_edges(
        self,
        graph_id: str,
        raw_nodes: list[dict[str, Any]],
        raw_edges: list[dict[str, Any]],
    ) -> dict[str, Any]:
        nodes: list[dict[str, Any]] = []
        node_map: dict[str, dict[str, Any]] = {}
        entity_types: set[str] = set()
        for raw_node in raw_nodes:
            normalized = self._normalize_remote_node(raw_node)
            if not normalized:
                continue
            node_id = str(normalized["uuid"])
            if node_id in node_map:
                continue
            node_map[node_id] = normalized
            nodes.append(normalized)
            for label in normalized.get("labels") or []:
                label_text = str(label)
                if label_text not in {"Entity", "Node", "Episode"}:
                    entity_types.add(label_text)

        node_name_map = {node_id: str(node.get("name") or node_id) for node_id, node in node_map.items()}
        edges: list[dict[str, Any]] = []
        seen_edges: set[tuple[str, str, str]] = set()
        for raw_edge in raw_edges:
            normalized = self._normalize_remote_edge(raw_edge, node_name_map)
            if not normalized:
                continue
            edge_key = (
                str(normalized["source_node_uuid"]),
                str(normalized["target_node_uuid"]),
                str(normalized["fact_type"]),
            )
            if edge_key in seen_edges:
                continue
            seen_edges.add(edge_key)
            edges.append(normalized)

        return {
            "graph_id": graph_id,
            "nodes": nodes,
            "edges": edges,
            "node_count": len(nodes),
            "edge_count": len(edges),
            "entity_types": sorted(entity_types),
        }

    def _extract_entities(self, text: str) -> list[str]:
        matches = re.findall(r"[\u4e00-\u9fff]{2,10}|[A-Za-z][A-Za-z0-9\-]{2,}", text or "")
        stopwords = {
            "未来", "预测", "议题", "平台", "关系", "报告", "新闻", "媒体", "内容",
            "分析", "研究", "当前", "系统", "数据", "动态", "行动", "信息", "source_ingest",
        }
        entities: list[str] = []
        seen: set[str] = set()
        for token in matches:
            token = token.strip()
            if not token or token in stopwords or token in seen:
                continue
            seen.add(token)
            entities.append(token)
            if len(entities) >= 8:
                break
        return entities

    def _classify_entity(self, token: str) -> str:
        actor_keywords = {"中国", "美国", "俄罗斯", "乌克兰", "伊朗", "以色列", "北约", "欧盟", "日本", "韩国"}
        region_keywords = {"台海", "台湾", "南海", "中东", "欧洲", "朝鲜半岛", "红海", "霍尔木兹"}
        if token in actor_keywords:
            return "Actor"
        if token in region_keywords:
            return "Region"
        if any(word in token for word in ("局势", "风险", "冲突", "停火", "制裁", "能源", "军演", "航运", "油价")):
            return "Concept"
        return "Concept" if len(token) > 4 else "Actor"

    def _episode_title(self, content: str, entities: list[str], index: int) -> str:
        preview = re.sub(r"\s+", " ", content or "").strip()
        if entities:
            return f"观察片段 {index + 1} · {entities[0]}"
        if preview:
            return f"观察片段 {index + 1} · {preview[:12]}"
        return f"观察片段 {index + 1}"

    def _episode_to_graph_data(self, graph_id: str, episodes: list[dict[str, Any]]) -> dict[str, Any]:
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, Any]] = []
        node_map: dict[str, dict[str, Any]] = {}
        edge_seen: set[tuple[str, str, str]] = set()
        entity_types: set[str] = set()

        def add_node(node_id: str, name: str, labels: list[str], summary: str = "", attributes: Optional[dict[str, Any]] = None, created_at: Optional[str] = None) -> None:
            if node_id in node_map:
                return
            record = {
                "uuid": node_id,
                "name": name,
                "labels": labels,
                "summary": summary,
                "attributes": attributes or {},
                "created_at": created_at,
            }
            node_map[node_id] = record
            nodes.append(record)
            for label in labels:
                if label not in {"Entity", "Node", "Episode"}:
                    entity_types.add(label)

        def add_edge(source: str, target: str, edge_type: str, fact: str, created_at: Optional[str], episode_uuid: Optional[str]) -> None:
            if source == target:
                return
            edge_key = (source, target, edge_type)
            if edge_key in edge_seen:
                return
            edge_seen.add(edge_key)
            edges.append(
                {
                    "uuid": f"{edge_type}::{source}::{target}",
                    "name": edge_type,
                    "fact": fact,
                    "fact_type": edge_type,
                    "source_node_uuid": source,
                    "target_node_uuid": target,
                    "source_node_name": node_map.get(source, {}).get("name", source),
                    "target_node_name": node_map.get(target, {}).get("name", target),
                    "attributes": {"weight": 0.8, "source": "episode"},
                    "created_at": created_at,
                    "valid_at": None,
                    "invalid_at": None,
                    "expired_at": None,
                    "episodes": [episode_uuid] if episode_uuid else [],
                }
            )

        for episode in episodes:
            episode_uuid = str(episode.get("uuid") or f"episode::{uuid.uuid4().hex[:8]}")
            content = str(episode.get("content") or "")
            created_at = str(episode.get("timestamp") or "")
            labels = [str(label) for label in (episode.get("labels") or []) if str(label).strip()]
            role = str(episode.get("role") or "")
            entities = self._extract_entities(content)
            episode_name = str(episode.get("name") or "") or self._episode_title(content, entities, len(nodes))
            add_node(
                episode_uuid,
                episode_name,
                labels or ["Episode"],
                summary=content[:240],
                attributes={
                    "role": role,
                    "source_description": episode.get("source_description"),
                    "content_preview": content[:320],
                },
                created_at=created_at or None,
            )
            for entity in entities:
                entity_id = f"entity::{entity}"
                add_node(
                    entity_id,
                    entity,
                    ["Entity", self._classify_entity(entity)],
                    summary=f"从原始情报片段中提取到的实体：{entity}",
                    attributes={"source": "episode_entity"},
                    created_at=created_at or None,
                )
                add_edge(episode_uuid, entity_id, "mentions", f"{episode_name} 提及 {entity}", created_at or None, episode_uuid)
            for index in range(len(entities)):
                for inner in range(index + 1, len(entities)):
                    source_id = f"entity::{entities[index]}"
                    target_id = f"entity::{entities[inner]}"
                    add_edge(source_id, target_id, "co_occurs_with", f"{entities[index]} 与 {entities[inner]} 在同一片段共同出现", created_at or None, episode_uuid)

        return {
            "graph_id": graph_id,
            "nodes": nodes,
            "edges": edges,
            "node_count": len(nodes),
            "edge_count": len(edges),
            "entity_types": sorted(entity_types),
        }

    def get_graph_data(self, graph_id: str) -> dict[str, Any]:
        raw_nodes = self._fetch_graph_nodes(graph_id)
        raw_edges = self._fetch_graph_edges(graph_id)
        if raw_nodes or raw_edges:
            remote_graph = self._graph_data_from_nodes_and_edges(graph_id, raw_nodes, raw_edges)
            snapshot = GraphSnapshotStore.load(graph_id)
            if snapshot and snapshot.get("nodes"):
                existing_node_ids = {str(node.get("uuid")) for node in remote_graph["nodes"] if isinstance(node, dict)}
                existing_edge_ids = {
                    (
                        str(edge.get("source_node_uuid") or ""),
                        str(edge.get("target_node_uuid") or ""),
                        str(edge.get("fact_type") or edge.get("name") or ""),
                    )
                    for edge in remote_graph["edges"]
                    if isinstance(edge, dict)
                }
                for node in snapshot.get("nodes") or []:
                    node_uuid = str(node.get("uuid") or "")
                    if node_uuid and node_uuid not in existing_node_ids:
                        remote_graph["nodes"].append(node)
                for edge in snapshot.get("edges") or []:
                    edge_key = (
                        str(edge.get("source_node_uuid") or ""),
                        str(edge.get("target_node_uuid") or ""),
                        str(edge.get("fact_type") or edge.get("name") or ""),
                    )
                    if edge_key not in existing_edge_ids:
                        remote_graph["edges"].append(edge)
                remote_graph["node_count"] = len(remote_graph["nodes"])
                remote_graph["edge_count"] = len(remote_graph["edges"])
                remote_graph["entity_types"] = sorted(
                    {
                        str(label)
                        for node in remote_graph["nodes"]
                        if isinstance(node, dict)
                        for label in (node.get("labels") or [])
                        if str(label) not in {"Entity", "Node", "Episode"}
                    }
                )
                remote_graph["source_mode"] = "remote_nodes_edges+snapshot"
            return remote_graph

        episodes = self._fetch_episodes(graph_id)
        if episodes:
            remote_data = self._episode_to_graph_data(graph_id, episodes)
            snapshot = GraphSnapshotStore.load(graph_id)
            if snapshot and snapshot.get("nodes"):
                existing_node_ids = {str(node.get("uuid")) for node in remote_data["nodes"] if isinstance(node, dict)}
                existing_edge_ids = {
                    (
                        str(edge.get("source_node_uuid") or ""),
                        str(edge.get("target_node_uuid") or ""),
                        str(edge.get("fact_type") or edge.get("name") or ""),
                    )
                    for edge in remote_data["edges"]
                    if isinstance(edge, dict)
                }
                for node in snapshot.get("nodes") or []:
                    node_uuid = str(node.get("uuid") or "")
                    if node_uuid and node_uuid not in existing_node_ids:
                        remote_data["nodes"].append(node)
                for edge in snapshot.get("edges") or []:
                    edge_key = (
                        str(edge.get("source_node_uuid") or ""),
                        str(edge.get("target_node_uuid") or ""),
                        str(edge.get("fact_type") or edge.get("name") or ""),
                    )
                    if edge_key not in existing_edge_ids:
                        remote_data["edges"].append(edge)
                remote_data["node_count"] = len(remote_data["nodes"])
                remote_data["edge_count"] = len(remote_data["edges"])
                remote_data["entity_types"] = sorted(
                    {
                        str(label)
                        for node in remote_data["nodes"]
                        if isinstance(node, dict)
                        for label in (node.get("labels") or [])
                        if str(label) not in {"Entity", "Node", "Episode"}
                    }
                )
                remote_data["source_mode"] = "episodes+snapshot"
            else:
                remote_data["source_mode"] = "episodes"
            return remote_data
        snapshot = GraphSnapshotStore.load(graph_id)
        if snapshot:
            snapshot.setdefault("source_mode", "snapshot")
            return snapshot
        return {
            "graph_id": graph_id,
            "nodes": [],
            "edges": [],
            "node_count": 0,
            "edge_count": 0,
            "entity_types": [],
            "source_mode": "empty",
        }

    def get_graph_info(self, graph_id: str) -> GraphInfo:
        """获取图谱统计信息。"""
        if self._mock:
            return GraphInfo(graph_id=graph_id, node_count=0, edge_count=0, entity_types=[])
        try:
            graph_data = self.get_graph_data(graph_id)
            if graph_data["node_count"] or graph_data["edge_count"]:
                return GraphInfo(
                    graph_id=graph_id,
                    node_count=int(graph_data["node_count"]),
                    edge_count=int(graph_data["edge_count"]),
                    entity_types=list(graph_data.get("entity_types") or []),
                )
            episodes = self._fetch_episodes(graph_id)
            if episodes:
                return self._extract_graph_info_from_episodes(graph_id, episodes)
        except Exception:
            pass
        return GraphInfo(graph_id=graph_id, node_count=0, edge_count=0, entity_types=[])

    def set_ontology(self, graph_id: str, ontology: dict) -> None:
        """Graphiti 模式下不需要远端注册本体，接口保留做向前兼容。"""
        return None
