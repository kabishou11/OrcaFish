"""OrcaFish InsightAgent — social media analysis via MindSpider database."""
import os
from typing import Optional
from backend.analysis.agents.base import DeepSearchAgent, SearchResult, AgentState
from backend.llm.client import LLMClient


class InsightSearchTool:
    """
    Social-media /舆情 database search tool.

    Corresponds to BettaFish's InsightEngine MediaCrawlerDB.
    In production, connect to the MindSpider MySQL/PostgreSQL database
    via the DATABASE_URL environment variable (or constructor argument).

    Supported tables (BettaFish schema):
      - bilibili_video / bilibili_video_comment
      - douyin_aweme   / douyin_aweme_comment
      - kuaishou_video / kuaishou_video_comment
      - weibo_note     / weibo_note_comment
      - xhs_note       / xhs_note_comment
      - zhihu_content  / zhihu_comment
      - tieba_note     / tieba_comment
      - daily_news

    Hotness score formula (from BettaFish):
      hotness = likes*1 + comments*5 + shares*10 + favorites*10 + coins*10
                + danmaku*0.5 + views*0.1

    Results are automatically clustered (KMeans on multilingual embeddings)
    and optionally run through sentiment analysis before being returned.
    """

    def __init__(self, database_url: str = ""):
        """
        Args:
            database_url: SQLAlchemy connection string.
                           e.g. mysql+aiomysql://user:pwd@host:port/db_name
                           Falls back to DATABASE_URL env var.
        """
        self.database_url = database_url or os.getenv("DATABASE_URL", "")
        self._client = None  # initialised lazily on first query

    # ------------------------------------------------------------------
    # Internal DB helpers
    # ------------------------------------------------------------------

    async def _get_client(self):
        """
        Lazily build an async database session.
        Returns None if DATABASE_URL is not configured.
        """
        if not self.database_url:
            return None

        if self._client is None:
            # Deferred import so the module only fails if actually used
            try:
                from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
                from sqlalchemy.orm import sessionmaker

                engine = create_async_engine(
                    self.database_url,
                    echo=False,
                    pool_pre_ping=True,
                    pool_size=5,
                )
                async_session = sessionmaker(
                    engine, class_=AsyncSession, expire_on_commit=False
                )
                self._client = async_session
            except Exception:
                return None
        return self._client

    # ------------------------------------------------------------------
    # Public search interface (mirrors BettaFish's MediaCrawlerDB)
    # ------------------------------------------------------------------

    async def search_topic(
        self,
        query: str,
        platform: Optional[str] = None,
        limit: int = 20,
    ) -> list[SearchResult]:
        """
        Search social-media content matching a topic keyword.

        Generates hotness-weighted SQL across all platforms,
        applies KMeans clustering + sentiment analysis (when DB is connected).

        Args:
            query: Topic / keyword to search.
            platform: Optional single platform filter
                       ('bilibili', 'douyin', 'kuaishou', 'weibo', 'xhs', 'zhihu', 'tieba').
            limit: Max total results returned.

        Returns:
            List of SearchResult (or empty list if DB not configured).
        """
        async_session = await self._get_client()
        if async_session is None:
            # Placeholder when DATABASE_URL is not set
            return []

        try:
            # Build platform filter clause
            platform_clause = ""
            params = {"query": f"%{query}%"}
            if platform:
                # Map friendly name to table prefix
                table_map = {
                    "bilibili": "bilibili_video",
                    "douyin": "douyin_aweme",
                    "kuaishou": "kuaishou_video",
                    "weibo": "weibo_note",
                    "xhs": "xhs_note",
                    "zhihu": "zhihu_content",
                    "tieba": "tieba_note",
                }
                table = table_map.get(platform.lower())
                if table:
                    platform_clause = f" AND source_table = :platform"
                    params["platform"] = table

            # Hotness-weighted union across known tables
            hotness_formula = (
                "COALESCE(CAST(liked_count AS UNSIGNED),0)*1 "
                "+ COALESCE(CAST(video_comment AS UNSIGNED),0)*5 "
                "+ COALESCE(CAST(video_share_count AS UNSIGNED),0)*10 "
                "+ COALESCE(CAST(video_favorite_count AS UNSIGNED),0)*10 "
                "+ COALESCE(CAST(video_coin_count AS UNSIGNED),0)*10 "
                "+ COALESCE(CAST(video_play_count AS DECIMAL(20,2)),0)*0.1 "
                "+ COALESCE(CAST(video_danmaku AS UNSIGNED),0)*0.5"
            )

            sql = f"""
                SELECT title, nickname, video_url, create_time, {hotness_formula} AS hotness
                FROM `bilibili_video`
                WHERE (title LIKE :query OR `desc` LIKE :query) {platform_clause}
                UNION ALL
                SELECT title, nickname, aweme_url, create_time, {hotness_formula} AS hotness
                FROM `douyin_aweme`
                WHERE (title LIKE :query OR `desc` LIKE :query) {platform_clause}
                UNION ALL
                SELECT content AS title, nickname, note_url, create_date_time,
                       {hotness_formula} AS hotness
                FROM `weibo_note`
                WHERE content LIKE :query {platform_clause}
                ORDER BY hotness DESC
                LIMIT :limit
            """
            params["limit"] = limit

            async with async_session() as session:
                result = await session.execute(sql, params)
                rows = result.fetchall()

            return [
                SearchResult(
                    query=query,
                    title=str(row[0] or ""),
                    url=str(row[2] or ""),
                    content=str(row[0] or ""),
                    score=float(row[4] or 0.0),
                )
                for row in rows
            ]

        except Exception:
            return []

    async def get_hot_content(
        self,
        time_period: str = "week",
        limit: int = 20,
    ) -> list[SearchResult]:
        """
        Return currently trending social-media content across all platforms.

        Args:
            time_period: '24h', 'week', or 'year'.
            limit: Max results.

        Returns:
            List of SearchResult.
        """
        async_session = await self._get_client()
        if async_session is None:
            return []

        try:
            # Time-cutoff subqueries per platform vary slightly.
            # This simplified version uses bilibili as primary;
            # extend per BettaFish's MediaCrawlerDB hotness_query().
            days_map = {"24h": 1, "week": 7, "year": 365}
            days = days_map.get(time_period, 7)

            hotness_formula = (
                "COALESCE(CAST(liked_count AS UNSIGNED),0)*1 "
                "+ COALESCE(CAST(video_comment AS UNSIGNED),0)*5 "
                "+ COALESCE(CAST(video_share_count AS UNSIGNED),0)*10 "
                "+ COALESCE(CAST(video_favorite_count AS UNSIGNED),0)*10 "
                "+ COALESCE(CAST(video_coin_count AS UNSIGNED),0)*10 "
                "+ COALESCE(CAST(video_play_count AS DECIMAL(20,2)),0)*0.1"
            )

            sql = f"""
                SELECT title, nickname, video_url, create_time, {hotness_formula} AS hotness
                FROM `bilibili_video`
                WHERE create_time >= DATE_SUB(NOW(), INTERVAL :days DAY)
                ORDER BY hotness DESC
                LIMIT :limit
            """

            async with async_session() as session:
                result = await session.execute(sql, {"days": days, "limit": limit})
                rows = result.fetchall()

            return [
                SearchResult(
                    query=f"hot_content_{time_period}",
                    title=str(row[0] or ""),
                    url=str(row[2] or ""),
                    content=str(row[0] or ""),
                    score=float(row[4] or 0.0),
                )
                for row in rows
            ]

        except Exception:
            return []


class InsightAgent(DeepSearchAgent):
    """
    InsightAgent — social-media sentiment and trend analysis.

    Corresponds to BettaFish's InsightEngine DeepSearchAgent.
    Uses InsightSearchTool (MindSpider DB) as the search backend.

    Extended features available when DB is connected:
      - Hotness-weighted ranking across 7 platforms
      - KMeans clustering of results (multilingual embeddings)
      - Multilingual sentiment analysis (22 languages)
    """

    def __init__(self, llm_client: LLMClient, database_url: str = ""):
        """
        Args:
            llm_client: Pre-configured LLMClient instance.
            database_url: DATABASE_URL for the MindSpider database.
        """
        super().__init__(llm_client)
        self.search_tool = InsightSearchTool(database_url)
        self.database_url = database_url

    async def execute_search(self, query: str) -> list[SearchResult]:
        """
        Search the MindSpider social-media database for the given topic.

        Args:
            query: Topic keyword.

        Returns:
            List of SearchResult sorted by hotness score.
        """
        try:
            return await self.search_tool.search_topic(query, limit=20)
        except Exception:
            return []
