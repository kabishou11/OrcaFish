"""Local graph snapshot store for self-hosted Graphiti fallback."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional


_SNAPSHOT_DIR = Path(__file__).resolve().parent.parent / "data" / "graph_snapshots"


class GraphSnapshotStore:
    @classmethod
    def _ensure_dir(cls) -> None:
        _SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)

    @classmethod
    def _path(cls, graph_id: str) -> Path:
        return _SNAPSHOT_DIR / f"{graph_id}.json"

    @classmethod
    def save(cls, graph_id: str, data: dict[str, Any]) -> None:
        cls._ensure_dir()
        cls._path(graph_id).write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @classmethod
    def load(cls, graph_id: str) -> Optional[dict[str, Any]]:
        path = cls._path(graph_id)
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

