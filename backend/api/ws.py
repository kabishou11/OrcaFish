"""OrcaFish WebSocket Broadcaster — real-time event push to connected clients."""
import asyncio
import json
from typing import Optional
from fastapi import WebSocket


class WebSocketBroadcaster:
    """
    Manages WebSocket connections and broadcasts pipeline events.

    Clients can subscribe to:
      - Global events (all pipelines): connect to /ws/global
      - Specific pipeline: connect to /ws/pipeline/{id}

    Usage in main.py:
        broadcaster = WebSocketBroadcaster()
        app.state.broadcaster = broadcaster
        # In orchestrator:
        await broadcaster.broadcast(event)
    """

    def __init__(self):
        # Global subscribers (receive ALL events)
        self._global: list[WebSocket] = []
        # Per-pipeline subscribers
        self._by_pipeline: dict[str, list[WebSocket]] = {}
        self._lock = asyncio.Lock()

    # ── Connection management ────────────────────────────────────────────

    async def connect(self, ws: WebSocket, pipeline_id: Optional[str] = None):
        """Register a WebSocket connection."""
        await ws.accept()
        async with self._lock:
            if pipeline_id:
                if pipeline_id not in self._by_pipeline:
                    self._by_pipeline[pipeline_id] = []
                self._by_pipeline[pipeline_id].append(ws)
            else:
                self._global.append(ws)

    async def disconnect(self, ws: WebSocket, pipeline_id: Optional[str] = None):
        """Remove a WebSocket connection."""
        async with self._lock:
            if pipeline_id:
                if pipeline_id in self._by_pipeline:
                    self._by_pipeline[pipeline_id] = [
                        c for c in self._by_pipeline[pipeline_id] if c != ws
                    ]
            else:
                self._global = [c for c in self._global if c != ws]

    # ── Broadcasting ─────────────────────────────────────────────────────

    async def broadcast(self, event) -> int:
        """
        Broadcast an event to all subscribers (global only).

        Args:
            event: Any object with a model_dump() method (e.g. PipelineEvent).

        Returns:
            Number of clients that received the message.
        """
        try:
            msg = json.dumps(event.model_dump(mode="json"), default=str)
        except Exception:
            msg = json.dumps({"error": "serialization failed"}, default=str)

        count = 0
        async with self._lock:
            dead = []
            for ws in self._global:
                try:
                    await ws.send_text(msg)
                    count += 1
                except Exception:
                    dead.append(ws)
            # Clean up dead connections
            for ws in dead:
                self._global.remove(ws)
        return count

    async def broadcast_to(
        self, pipeline_id: str, event
    ) -> int:
        """
        Broadcast an event to subscribers of a specific pipeline.

        Args:
            pipeline_id: Pipeline identifier.
            event: Event to broadcast.

        Returns:
            Number of clients that received the message.
        """
        try:
            msg = json.dumps(event.model_dump(mode="json"), default=str)
        except Exception:
            msg = json.dumps({"error": "serialization failed"}, default=str)

        count = 0
        async with self._lock:
            dead = []
            target = self._by_pipeline.get(pipeline_id, [])
            for ws in target:
                try:
                    await ws.send_text(msg)
                    count += 1
                except Exception:
                    dead.append(ws)
            for ws in dead:
                if ws in self._by_pipeline.get(pipeline_id, []):
                    self._by_pipeline[pipeline_id].remove(ws)
        return count

    # ── Utilities ─────────────────────────────────────────────────────────

    @property
    def global_count(self) -> int:
        return len(self._global)

    def pipeline_count(self, pipeline_id: str) -> int:
        return len(self._by_pipeline.get(pipeline_id, []))

    def total_connections(self) -> int:
        total = len(self._global)
        for lst in self._by_pipeline.values():
            total += len(lst)
        return total
