from __future__ import annotations

"""轻量图谱检索工具，优先尝试远端搜索接口，失败后回退到本地图谱数据匹配。"""

from dataclasses import dataclass
from typing import Any, Optional

import httpx

from .graph_builder import GraphBuilder


@dataclass
class SearchResult:
    facts: list[str]
    edges: list[dict[str, Any]]
    nodes: list[dict[str, Any]]
    query: str
    total_count: int
    source_mode: str = "local"

    def to_dict(self) -> dict[str, Any]:
        return {
            "facts": self.facts,
            "edges": self.edges,
            "nodes": self.nodes,
            "query": self.query,
            "total_count": self.total_count,
            "source_mode": self.source_mode,
        }


class ZepTools:
    def __init__(self, builder: Optional[GraphBuilder] = None):
        self.builder = builder or GraphBuilder()

    def search_graph(self, graph_id: str, query: str, limit: int = 8, scope: str = "edges") -> SearchResult:
        remote_result = self._remote_search(graph_id=graph_id, query=query, limit=limit, scope=scope)
        if remote_result:
            return remote_result
        return self._local_search(graph_id=graph_id, query=query, limit=limit, scope=scope)

    def _remote_search(self, graph_id: str, query: str, limit: int, scope: str) -> Optional[SearchResult]:
        if self.builder._mock or not self.builder.base_url:
            return None

        path_candidates = ["/search", f"/graphs/{graph_id}/search", f"/graph/{graph_id}/search"]
        payloads = [
            {"graph_id": graph_id, "query": query, "limit": limit, "scope": scope},
            {"group_id": graph_id, "query": query, "limit": limit, "scope": scope},
        ]

        for path in path_candidates:
            for payload in payloads:
                try:
                    with httpx.Client(timeout=20) as client:
                        response = client.post(
                            f"{self.builder.base_url}{path}",
                            headers=self.builder._headers(),
                            json=payload,
                        )
                    if not response.is_success:
                        continue
                    body = response.json()
                except Exception:
                    continue

                facts = self._extract_text_items(body, ("facts", "results", "items", "data"))
                edges = self._extract_dict_items(body, ("edges", "results", "items", "data"))
                nodes = self._extract_dict_items(body, ("nodes", "results", "items", "data"))
                if not facts and not edges and not nodes:
                    continue
                return SearchResult(
                    facts=facts[:limit],
                    edges=edges[:limit],
                    nodes=nodes[:limit],
                    query=query,
                    total_count=max(len(facts), len(edges), len(nodes)),
                    source_mode="remote_search",
                )
        return None

    def _local_search(self, graph_id: str, query: str, limit: int, scope: str) -> SearchResult:
        graph_data = self.builder.get_graph_data(graph_id)
        nodes = list(graph_data.get("nodes") or [])
        edges = list(graph_data.get("edges") or [])
        query_lower = (query or "").strip().lower()
        keywords = [part.strip() for part in query_lower.replace("，", " ").replace(",", " ").split() if len(part.strip()) > 1]

        def score_text(text: str) -> int:
            haystack = (text or "").lower()
            if not haystack:
                return 0
            if query_lower and query_lower in haystack:
                return 100
            return sum(12 for keyword in keywords if keyword and keyword in haystack)

        scored_edges: list[tuple[int, dict[str, Any]]] = []
        scored_nodes: list[tuple[int, dict[str, Any]]] = []

        if scope in {"edges", "both"}:
            for edge in edges:
                score = score_text(str(edge.get("fact") or "")) + score_text(str(edge.get("name") or edge.get("fact_type") or ""))
                if score > 0:
                    scored_edges.append((score, edge))

        if scope in {"nodes", "both"}:
            for node in nodes:
                attrs = node.get("attributes") if isinstance(node.get("attributes"), dict) else {}
                preview = str(attrs.get("content_preview") or attrs.get("summary") or "")
                score = (
                    score_text(str(node.get("name") or ""))
                    + score_text(str(node.get("summary") or ""))
                    + score_text(preview)
                )
                if score > 0:
                    scored_nodes.append((score, node))

        scored_edges.sort(key=lambda item: item[0], reverse=True)
        scored_nodes.sort(key=lambda item: item[0], reverse=True)
        matched_edges = [edge for _, edge in scored_edges[:limit]]
        matched_nodes = [node for _, node in scored_nodes[:limit]]

        facts: list[str] = []
        for edge in matched_edges:
            fact = str(edge.get("fact") or "").strip()
            if fact:
                facts.append(fact)
        for node in matched_nodes:
            name = str(node.get("name") or "图谱节点").strip() or "图谱节点"
            summary = str(node.get("summary") or "").strip()
            attrs = node.get("attributes") if isinstance(node.get("attributes"), dict) else {}
            preview = str(attrs.get("content_preview") or attrs.get("summary") or "").strip()
            if summary:
                facts.append(f"[{name}] {summary}")
            elif preview:
                facts.append(f"[{name}] {preview}")

        return SearchResult(
            facts=facts[:limit],
            edges=matched_edges,
            nodes=matched_nodes,
            query=query,
            total_count=max(len(facts), len(matched_edges), len(matched_nodes)),
            source_mode=f"local_{graph_data.get('source_mode') or 'graph'}",
        )

    @staticmethod
    def _extract_text_items(payload: Any, keys: tuple[str, ...]) -> list[str]:
        results: list[str] = []
        if isinstance(payload, list):
            for item in payload:
                if isinstance(item, str):
                    results.append(item)
                elif isinstance(item, dict):
                    text = str(item.get("fact") or item.get("summary") or item.get("content") or "").strip()
                    if text:
                        results.append(text)
            return results
        if not isinstance(payload, dict):
            return results
        for key in keys:
            value = payload.get(key)
            if isinstance(value, list):
                for item in value:
                    if isinstance(item, str):
                        results.append(item)
                    elif isinstance(item, dict):
                        text = str(item.get("fact") or item.get("summary") or item.get("content") or "").strip()
                        if text:
                            results.append(text)
        return results

    @staticmethod
    def _extract_dict_items(payload: Any, keys: tuple[str, ...]) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if not isinstance(payload, dict):
            return []
        for key in keys:
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        return []
