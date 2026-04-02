from __future__ import annotations
"""OrcaFish MediaAgent — multimodal analysis using Bocha Search API."""
import os
import httpx
from typing import Optional
from backend.analysis.agents.base import DeepSearchAgent, SearchResult, AgentState
from backend.analysis.crawl4ai_client import Crawl4AIClient
from backend.llm.client import LLMClient


class BochaSearchTool:
    """
    Bocha AI Search (multimodal) wrapper — corresponds to BettaFish's MediaEngine tools.

    Supports multiple tool modes:
      - comprehensive_search  : full multimodal (web + images + AI answer)
      - web_search_only       : fast web-only
      - search_last_24_hours  : latest info
      - search_last_week      : weekly round-up

    API docs: https://open.bochaai.com/
    """

    BASE_URL = "https://api.bochaai.com/v1/search"

    def __init__(self, api_key: str = ""):
        self.api_key = api_key or os.getenv("BOCHA_API_KEY", "")

    # ------------------------------------------------------------------
    # Low-level request helper
    # ------------------------------------------------------------------

    async def _post(
        self,
        payload: dict,
        timeout: float = 60.0,
    ) -> dict:
        """Make an authenticated POST request to the Bocha API."""
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                self.BASE_URL,
                json=payload,
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            resp.raise_for_status()
            return resp.json()

    # ------------------------------------------------------------------
    # Search methods
    # ------------------------------------------------------------------

    async def comprehensive_search(
        self, query: str, count: int = 8
    ) -> list[SearchResult]:
        """
        Full multimodal search: webpages, images, AI answer, follow-up suggestions.

        Args:
            query: Search query.
            count: Number of web results to return.

        Returns:
            List of SearchResult from web page hits.
        """
        try:
            data = await self._post(
                {
                    "query": query,
                    "count": count,
                    "type": "latest",
                    "answer": True,
                    "stream": False,
                },
                timeout=60.0,
            )
            web_results = data.get("data", {}).get("webResults", [])
            return [
                SearchResult(
                    query=query,
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    content=r.get("snippet", ""),
                    score=float(r.get("score", 0.0)),
                )
                for r in web_results
            ]
        except Exception:
            return []

    async def web_search_only(
        self, query: str, count: int = 10
    ) -> list[SearchResult]:
        """
        Fast, web-links-only search (no AI answer generation).

        Args:
            query: Search query.
            count: Number of web results.

        Returns:
            List of SearchResult.
        """
        try:
            data = await self._post(
                {
                    "query": query,
                    "count": count,
                    "answer": False,
                    "stream": False,
                },
                timeout=30.0,
            )
            web_results = data.get("data", {}).get("webResults", [])
            return [
                SearchResult(
                    query=query,
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    content=r.get("snippet", ""),
                    score=float(r.get("score", 0.0)),
                )
                for r in web_results
            ]
        except Exception:
            return []

    async def search_last_24_hours(
        self, query: str, count: int = 8
    ) -> list[SearchResult]:
        """Search content published in the last 24 hours."""
        try:
            data = await self._post(
                {
                    "query": query,
                    "count": count,
                    "freshness": "oneDay",
                    "answer": True,
                    "stream": False,
                },
                timeout=60.0,
            )
            web_results = data.get("data", {}).get("webResults", [])
            return [
                SearchResult(
                    query=query,
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    content=r.get("snippet", ""),
                    score=float(r.get("score", 0.0)),
                )
                for r in web_results
            ]
        except Exception:
            return []

    async def search_last_week(
        self, query: str, count: int = 8
    ) -> list[SearchResult]:
        """Search content published in the last 7 days."""
        try:
            data = await self._post(
                {
                    "query": query,
                    "count": count,
                    "freshness": "oneWeek",
                    "answer": True,
                    "stream": False,
                },
                timeout=60.0,
            )
            web_results = data.get("data", {}).get("webResults", [])
            return [
                SearchResult(
                    query=query,
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    content=r.get("snippet", ""),
                    score=float(r.get("score", 0.0)),
                )
                for r in web_results
            ]
        except Exception:
            return []


class MediaAgent(DeepSearchAgent):
    """
    MediaAgent — multimodal content analysis powered by Bocha Search.

    Corresponds to BettaFish's MediaEngine DeepSearchAgent.
    Inherits the 3-step pipeline (structure → paragraph processing → format).
    """

    def __init__(self, llm_client: LLMClient, bocha_api_key: str = ""):
        """
        Args:
            llm_client: Pre-configured LLMClient instance.
            bocha_api_key: Bocha API key. Falls back to BOCHA_API_KEY env var.
        """
        super().__init__(llm_client)
        self.search_tool = BochaSearchTool(bocha_api_key)
        self.crawl_client = Crawl4AIClient()

    async def execute_search(self, query: str) -> list[SearchResult]:
        """
        Default: comprehensive multimodal search.

        Args:
            query: Search query.

        Returns:
            List of SearchResult.
        """
        try:
            results = await self.search_tool.comprehensive_search(query, count=8)
        except Exception:
            results = []

        enriched: list[SearchResult] = []
        for item in results:
            content = await self.crawl_client.enrich_content(item.url, fallback=item.content)
            enriched.append(SearchResult(
                query=item.query,
                title=item.title,
                url=item.url,
                content=content,
                score=item.score,
            ))
        return enriched
