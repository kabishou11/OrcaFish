"""Crawl4AI 本地适配层。"""
from __future__ import annotations

from typing import Any

import httpx

from backend.config import settings


class Crawl4AIClient:
    def __init__(self, base_url: str | None = None, token: str | None = None):
        self.base_url = (base_url or settings.crawl4ai_base_url).rstrip("/")
        self.token = token or settings.crawl4ai_token

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    async def crawl_markdown(self, url: str) -> dict[str, Any] | None:
        if not self.base_url or not url:
            return None
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                resp = await client.post(
                    f"{self.base_url}/md",
                    headers=self._headers(),
                    json={"url": url},
                )
                if resp.is_success:
                    data = resp.json()
                    if isinstance(data, dict):
                        return data
        except Exception:
            return None
        return None

    async def enrich_content(self, url: str, fallback: str = "") -> str:
        data = await self.crawl_markdown(url)
        if not data:
            return fallback
        for key in ("markdown", "content", "fit_markdown", "result"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return fallback
