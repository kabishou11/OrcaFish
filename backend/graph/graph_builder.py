"""Graph building service — Zep CE (Community Edition) HTTP 接入"""
from __future__ import annotations

import uuid
import time
from typing import Optional
import httpx

from ..config import settings
from .models import GraphInfo


class GraphBuilder:
    """通过 Zep CE 本地服务构建知识图谱。

    Zep CE REST API 基础路径：http://localhost:8000
    当 zep_base_url 为空时降级为 mock 模式（开发/测试用）。
    """

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        self.base_url = (base_url or settings.zep_base_url).rstrip("/")
        self.api_secret = settings.zep_api_secret
        # api_key 参数保留做向后兼容，不再使用
        self._mock = not self.base_url

    def _headers(self) -> dict:
        h: dict = {"Content-Type": "application/json"}
        if self.api_secret:
            h["Authorization"] = f"Bearer {self.api_secret}"
        return h

    # ── 公开接口 ─────────────────────────────────────────────────────────

    def create_graph(self, name: str) -> str:
        """在 Zep CE 中创建一个 user（用 UUID 作为 user_id 模拟图谱）"""
        if self._mock:
            return f"mock_graph_{uuid.uuid4().hex[:16]}"
        graph_id = f"orcafish_{uuid.uuid4().hex[:16]}"
        try:
            with httpx.Client(timeout=30) as client:
                client.post(
                    f"{self.base_url}/api/v2/users",
                    headers=self._headers(),
                    json={"user_id": graph_id, "metadata": {"name": name, "source": "orcafish"}},
                )
        except Exception:
            pass
        return graph_id

    def add_text_batch(self, graph_id: str, text_chunks: list[str]) -> list[str]:
        """向 Zep CE 写入文本记忆片段（以 memory messages 方式）"""
        if self._mock:
            return [f"mock_ep_{i}" for i in range(len(text_chunks))]
        session_id = f"sess_{uuid.uuid4().hex[:12]}"
        episode_ids: list[str] = []
        try:
            with httpx.Client(timeout=60) as client:
                # 先建 session
                client.post(
                    f"{self.base_url}/api/v2/sessions",
                    headers=self._headers(),
                    json={"session_id": session_id, "user_id": graph_id},
                )
                # 批量写入消息
                messages = [
                    {"role": "system", "role_type": "system", "content": chunk}
                    for chunk in text_chunks
                ]
                resp = client.post(
                    f"{self.base_url}/api/v2/sessions/{session_id}/memory",
                    headers=self._headers(),
                    json={"messages": messages},
                )
                if resp.is_success:
                    data = resp.json()
                    episode_ids = [m.get("uuid", "") for m in data.get("messages", [])]
        except Exception:
            pass
        return episode_ids or [f"ep_{i}" for i in range(len(text_chunks))]

    def wait_for_processing(self, episode_uuids: list[str], timeout: int = 60):
        """Zep CE 写入是同步的，无需等待；保留接口兼容性"""
        pass

    def get_graph_info(self, graph_id: str) -> GraphInfo:
        """获取图谱统计信息"""
        if self._mock:
            return GraphInfo(graph_id=graph_id, node_count=0, edge_count=0, entity_types=[])
        try:
            with httpx.Client(timeout=30) as client:
                resp = client.get(
                    f"{self.base_url}/api/v2/graph/nodes",
                    headers=self._headers(),
                    params={"user_id": graph_id, "limit": 1000},
                )
                if resp.is_success:
                    data = resp.json()
                    nodes = data.get("nodes", [])
                    return GraphInfo(
                        graph_id=graph_id,
                        node_count=len(nodes),
                        edge_count=0,
                        entity_types=list({n.get("type", "") for n in nodes if n.get("type")}),
                    )
        except Exception:
            pass
        return GraphInfo(graph_id=graph_id, node_count=0, edge_count=0, entity_types=[])

    def set_ontology(self, graph_id: str, ontology: dict) -> None:
        """Zep CE 社区版暂不支持自定义本体，接口保留做向前兼容"""
        pass
