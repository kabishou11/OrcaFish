from __future__ import annotations
"""OrcaFish QueryAgent — web news analysis using Tavily Search API."""
import os
import httpx
from backend.analysis.agents.base import DeepSearchAgent, SearchResult, AgentState
from backend.llm.client import LLMClient


class TavilySearchTool:
    """
    Tavily News API wrapper — corresponds to BettaFish's QueryEngine tools.

    Docs: https://docs.tavily.com/
    API endpoint: https://api.tavily.com/search
    """

    BASE_URL = "https://api.tavily.com/search"

    def __init__(self, api_key: str = ""):
        self.api_key = api_key or os.getenv("TAVILY_API_KEY", "")

    # ------------------------------------------------------------------
    # Search methods
    # ------------------------------------------------------------------

    async def basic_search(
        self, query: str, num_results: int = 5
    ) -> list[SearchResult]:
        """
        Fast basic news search.

        Args:
            query: Search query.
            num_results: Number of results to return (max 20).

        Returns:
            List of SearchResult objects.
        """
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                self.BASE_URL,
                json={
                    "api_key": self.api_key,
                    "query": query,
                    "search_depth": "basic",
                    "num_results": num_results,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return [
                SearchResult(
                    query=query,
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    content=r.get("raw_content", r.get("content", "")),
                    score=float(r.get("score", 0.0)),
                )
                for r in data.get("results", [])
            ]

    async def deep_search(
        self, query: str, num_results: int = 8
    ) -> list[SearchResult]:
        """
        Advanced news search — deeper crawl, more context.

        Args:
            query: Search query.
            num_results: Number of results to return (max 20).

        Returns:
            List of SearchResult objects.
        """
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                self.BASE_URL,
                json={
                    "api_key": self.api_key,
                    "query": query,
                    "search_depth": "advanced",
                    "num_results": num_results,
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return [
                SearchResult(
                    query=query,
                    title=r.get("title", ""),
                    url=r.get("url", ""),
                    content=r.get("raw_content", r.get("content", "")),
                    score=float(r.get("score", 0.0)),
                )
                for r in data.get("results", [])
            ]


class QueryAgent(DeepSearchAgent):
    """
    QueryAgent — internet / news analysis powered by Tavily.

    Corresponds to BettaFish's QueryEngine DeepSearchAgent.
    Uses ``TavilySearchTool`` for both basic and advanced (deep) search.
    """

    def __init__(self, llm_client: LLMClient, tavily_api_key: str = ""):
        """
        Args:
            llm_client: Pre-configured LLMClient instance.
            tavily_api_key: Tavily API key. Falls back to TAVILY_API_KEY env var.
        """
        super().__init__(llm_client)
        self.search_tool = TavilySearchTool(tavily_api_key)

    async def execute_search(self, query: str) -> list[SearchResult]:
        """
        Primary search entry — uses deep search with fallback to basic.

        Args:
            query: Search query string.

        Returns:
            List of SearchResult from Tavily.
        """
        try:
            results = await self.search_tool.deep_search(query, num_results=8)
        except Exception:
            try:
                results = await self.search_tool.basic_search(query, num_results=5)
            except Exception:
                results = []

        return results
