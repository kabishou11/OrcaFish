from __future__ import annotations
"""OrcaFish DeepSearchAgent Base — ported from BettaFish QueryEngine/agent.py"""
import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse
from backend.llm.client import LLMClient


@dataclass
class SearchResult:
    """A single search result returned by a tool."""

    query: str
    url: str = ""
    title: str = ""
    content: str = ""
    score: float = 0.0
    timestamp: datetime = field(default_factory=datetime.utcnow)

    def __post_init__(self):
        # Normalise timestamp
        if isinstance(self.timestamp, str):
            self.timestamp = datetime.fromisoformat(self.timestamp)


@dataclass
class Paragraph:
    """
    A planned section of the research report.
    Accumulates search history and the latest LLM summary.
    """

    title: str
    content: str = ""  # planning note / description of required coverage
    order: int = 0
    search_history: list[SearchResult] = field(default_factory=list)
    latest_summary: str = ""
    is_completed: bool = False

    def add_result(self, result: SearchResult) -> None:
        """Append a search result, deduplicating by URL."""
        if result.url and any(r.url == result.url for r in self.search_history):
            return
        self.search_history.append(result)


@dataclass
class AgentSourceMetrics:
    """Aggregated source-quality metrics for one agent run."""

    result_count: int = 0
    unique_source_count: int = 0
    enriched_result_count: int = 0
    paragraph_with_sources: int = 0
    paragraph_count: int = 0
    max_paragraph_sources: int = 0

    @property
    def has_real_sources(self) -> bool:
        return self.unique_source_count > 0 or self.result_count > 0

    @property
    def is_dense(self) -> bool:
        return self.unique_source_count >= 3 or self.result_count >= 4 or self.enriched_result_count >= 2


@dataclass
class AgentState:
    """Full research session state."""

    query: str
    report_title: str = ""
    paragraphs: list[Paragraph] = field(default_factory=list)
    final_report: str = ""
    source_metrics: AgentSourceMetrics = field(default_factory=AgentSourceMetrics)
    is_completed: bool = False
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


def _source_label_from_url(url: str) -> str:
    host = urlparse(url).netloc.lower().strip()
    if host.startswith("www."):
        host = host[4:]
    return host or "外部来源"


def _format_source_timestamp(timestamp: datetime | str | None) -> str:
    if isinstance(timestamp, str):
        raw = timestamp.strip()
        if not raw:
            return ""
        try:
            timestamp = datetime.fromisoformat(raw)
        except ValueError:
            return raw
    if isinstance(timestamp, datetime):
        return timestamp.strftime("%Y-%m-%d %H:%M")
    return ""


def build_source_facts_from_results(
    results: list[SearchResult],
    limit: int = 8,
    paragraph_title: str = "",
) -> list[dict[str, str]]:
    facts: list[dict[str, str]] = []
    seen: set[str] = set()
    ranked_results = sorted(
        results,
        key=lambda item: (
            -(len((item.content or "").strip())),
            -(item.score or 0.0),
            -(item.timestamp.timestamp() if isinstance(item.timestamp, datetime) else 0.0),
        ),
    )
    for result in ranked_results:
        title = (result.title or "").strip()
        summary = " ".join((result.content or "").split())[:220]
        identity = (result.url or "").strip() or title or summary
        if not identity or identity in seen:
            continue
        seen.add(identity)
        facts.append(
            {
                "title": title or (summary[:48] if summary else "未命名来源"),
                "source": _source_label_from_url(result.url),
                "url": (result.url or "").strip(),
                "summary": summary or "检索已命中该来源，但正文摘要仍在补全。",
                "paragraph_title": paragraph_title,
                "published_at": _format_source_timestamp(result.timestamp),
            }
        )
        if len(facts) >= limit:
            break
    return facts


def extract_source_facts(state: AgentState, limit: int = 8) -> list[dict[str, str]]:
    facts: list[dict[str, str]] = []
    seen: set[str] = set()
    ordered_paragraphs = sorted(state.paragraphs, key=lambda item: item.order)
    for para in ordered_paragraphs:
        for fact in build_source_facts_from_results(para.search_history, limit=limit, paragraph_title=para.title):
            identity = fact["url"] or f"{fact['source']}::{fact['title']}"
            if identity in seen:
                continue
            seen.add(identity)
            facts.append(fact)
            if len(facts) >= limit:
                return facts
    return facts


def calculate_source_metrics(state: AgentState) -> AgentSourceMetrics:
    metrics = AgentSourceMetrics()
    metrics.paragraph_count = len(state.paragraphs)
    unique_sources: set[str] = set()
    for para in state.paragraphs:
        para_source_count = 0
        for result in para.search_history:
            identity = (result.url or "").strip()
            if identity:
                unique_sources.add(identity)
            else:
                title_identity = (result.title or "").strip()
                if title_identity:
                    unique_sources.add(f"title::{title_identity}")
            metrics.result_count += 1
            if len((result.content or "").strip()) >= 200:
                metrics.enriched_result_count += 1
            para_source_count += 1
        if para_source_count > 0:
            metrics.paragraph_with_sources += 1
        metrics.max_paragraph_sources = max(metrics.max_paragraph_sources, para_source_count)
    metrics.unique_source_count = len(unique_sources)
    return metrics


class DeepSearchAgent(ABC):
    """
    Base class for all analysis agents (Query / Media / Insight).

    Pipeline (mirrors BettaFish's DeepSearchAgent.research):
      1. Generate report structure  — LLM generates chapter outline (JSON)
      2. Process each paragraph    — per paragraph: search → summarise → reflect loop
      3. Format final report        — LLM assembles chapters into markdown

    Subclasses only need to implement ``execute_search``.
    """

    # ------------------------------------------------------------------
    # Class-level prompt library
    # ------------------------------------------------------------------

    REPORT_STRUCTURE_PROMPT = """你是一个专业的情报报告结构设计专家。
根据用户的研究主题，生成一份深度研究报告的章节结构。

主题: {query}

请生成3-6个主要章节，每个章节包含：
- 标题（简洁有力）
- 内容规划（描述该章节需要覆盖的关键点）

以JSON格式输出：
{{
  "title": "关于{主题}的深度研究报告",
  "paragraphs": [
    {{"title": "章节标题", "content": "该章节需要分析的核心问题"}}
  ]
}}

只输出JSON，不要有其他内容。"""

    SUMMARY_PROMPT = """你是一个情报分析专家。根据以下搜索结果，撰写关于"{paragraph_title}"的深度分析内容。

搜索结果：
{search_results}

要求：
- 内容详实，引用具体数据和事件
- 150-300字
- 使用中文撰写
- 客观分析，不带偏见

直接输出分析内容："""

    REFLECTION_PROMPT = """当前分析内容：
{current_content}

现有搜索来源：
{existing_sources}

分析目标：{paragraph_title}

请判断：现有分析是否足够深入？如果需要更多搜索，请用JSON格式提出新的搜索查询：
{{"need_search": true/false, "search_query": "具体搜索查询", "reasoning": "判断理由"}}

如果已足够，请输出：
{{"need_search": false, "reasoning": "当前分析已足够全面"}}"""

    FINAL_FORMAT_PROMPT = """你是一个专业的舆情分析报告撰写专家。
将以下研究内容整理成一份完整的研究报告。

研究主题：{query}

研究报告内容：
{content}

请按以下格式整理：
1. 标题使用 # 标题
2. 每个章节使用 ## 章节标题
3. 内容详实，有理有据
4. 结尾有总结

直接输出Markdown格式报告："""

    # ------------------------------------------------------------------
    # Config
    # ------------------------------------------------------------------

    MAX_REFLECTIONS: int = 2  # default; subclasses can override

    # ------------------------------------------------------------------
    # Init
    # ------------------------------------------------------------------

    def __init__(self, llm_client: LLMClient):
        self.llm = llm_client

    # ------------------------------------------------------------------
    # Abstract search interface
    # ------------------------------------------------------------------

    @abstractmethod
    async def execute_search(self, query: str) -> list[SearchResult]:
        """
        Execute a search using the agent's specific tools.

        Args:
            query: Free-text search query.

        Returns:
            List of SearchResult objects. May be empty.
        """
        raise NotImplementedError

    # ------------------------------------------------------------------
    # Pipeline steps
    # ------------------------------------------------------------------

    async def _generate_structure(self, query: str) -> AgentState:
        """
        Step 1 — Generate report outline via LLM.
        The LLM returns a JSON blob with title + paragraphs.
        """
        prompt = self.REPORT_STRUCTURE_PROMPT.format(query=query)
        try:
            result = await self.llm.invoke_json(
                system_prompt="你是一个情报报告结构设计专家。",
                user_prompt=prompt,
            )
        except Exception:
            # Fallback: simple single-chapter structure
            state = AgentState(query=query)
            state.report_title = f"关于{query}的深度研究报告"
            state.paragraphs = [
                Paragraph(title="概述", content=query, order=0),
            ]
            return state

        state = AgentState(query=query)
        state.report_title = result.get("title", f"关于{query}的深度研究报告")
        for i, p in enumerate(result.get("paragraphs", [])):
            state.paragraphs.append(
                Paragraph(
                    title=p.get("title", ""),
                    content=p.get("content", ""),
                    order=i,
                )
            )
        return state

    async def _process_paragraph(self, para: Paragraph, query: str) -> str:
        """
        Step 2 — For one paragraph:
          a) Initial search
          b) LLM summarisation
          c) Reflection loop (up to MAX_REFLECTIONS times)
        """
        # (a) Initial search
        search_results = await self.execute_search(para.content or para.title)
        # 尝试通过 Crawl4AI 抓取正文，补充 SearchResult 的 content
        search_results = await self._enrich_with_crawl4ai(search_results)
        for r in search_results:
            para.add_result(r)

        if not search_results:
            para.latest_summary = ""
            para.is_completed = True
            return ""

        # (b) First summary
        content = await self._summarize(para, query)

        # (c) Reflection loop
        for _ in range(self.MAX_REFLECTIONS):
            recent_sources = "\n".join(
                f"- {r.title}: {r.content[:100]}"
                for r in para.search_history[-3:]
            )
            try:
                reflection = await self.llm.invoke_json(
                    system_prompt="你是一个情报分析审核专家。",
                    user_prompt=self.REFLECTION_PROMPT.format(
                        current_content=content,
                        existing_sources=recent_sources,
                        paragraph_title=para.title,
                    ),
                )
            except Exception:
                break

            if not reflection.get("need_search", False):
                break

            new_query = reflection.get("search_query", "")
            if new_query:
                new_results = await self.execute_search(new_query)
                for r in new_results:
                    para.add_result(r)
                if new_results:
                    content = await self._summarize(para, query, extra_results=new_results)

        para.latest_summary = content
        para.is_completed = True
        return content

    async def _enrich_with_crawl4ai(self, results: list[SearchResult]) -> list[SearchResult]:
        """用 Crawl4AI 补充搜索结果的正文内容（只对有 URL 且正文短的结果操作）。
        Crawl4AI 服务不可用时静默降级，不影响主流程。"""
        try:
            from backend.crawl4ai_client import crawl_url
            urls_to_fetch = [r.url for r in results if r.url and len(r.content) < 200]
            if not urls_to_fetch:
                return results
            import asyncio
            crawl_tasks = [crawl_url(url, timeout=20) for url in urls_to_fetch]
            crawl_results = await asyncio.gather(*crawl_tasks, return_exceptions=True)
            url_to_md: dict = {}
            for url, cr in zip(urls_to_fetch, crawl_results):
                if isinstance(cr, dict) and cr.get("success") and cr.get("markdown"):
                    url_to_md[url] = cr["markdown"][:1500]  # 截断，避免过长
            for r in results:
                if r.url in url_to_md:
                    r.content = url_to_md[r.url]
        except Exception:
            pass
        return results

    async def _summarize(
        self,
        para: Paragraph,
        query: str,
        extra_results: Optional[list[SearchResult]] = None,
    ) -> str:
        """
        Build a paragraph summary from accumulated search results.
        """
        all_results = para.search_history + (extra_results or [])
        if not all_results:
            return ""

        # Take up to 5 most recent results
        display_results = all_results[-5:]
        search_text = "\n\n".join(
            f"来源{i+1} [{r.title}]({r.url}):\n{r.content[:500]}"
            for i, r in enumerate(display_results)
        )

        return await self.llm.invoke(
            system_prompt="你是一个情报分析专家，擅长从多源信息中提取关键洞察。",
            user_prompt=self.SUMMARY_PROMPT.format(
                paragraph_title=para.title,
                search_results=search_text,
            ),
            max_tokens=1024,
        )

    async def _format_report(self, state: AgentState) -> str:
        """
        Step 3 — Format the final markdown report from all paragraph summaries.
        """
        sections = "\n\n".join(
            f"## {p.title}\n\n{p.latest_summary or p.content}"
            for p in sorted(state.paragraphs, key=lambda x: x.order)
        )
        return await self.llm.invoke(
            system_prompt="你是一个专业的情报报告撰写专家。",
            user_prompt=self.FINAL_FORMAT_PROMPT.format(
                query=state.query,
                content=sections,
            ),
            max_tokens=8192,
        )

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def research(self, query: str) -> AgentState:
        """
        Run the full research pipeline.

        Args:
            query: The research question / topic.

        Returns:
            AgentState with final_report populated.
        """
        # Step 1: Generate structure
        state = await self._generate_structure(query)

        # Step 2: Process each paragraph (limited concurrency)
        semaphore = asyncio.Semaphore(2)

        async def process_one(para: Paragraph) -> Paragraph:
            async with semaphore:
                await self._process_paragraph(para, query)
                return para

        await asyncio.gather(*[process_one(p) for p in state.paragraphs])

        state.source_metrics = calculate_source_metrics(state)

        # Step 3: Format final report
        state.final_report = await self._format_report(state)
        state.is_completed = True
        state.updated_at = datetime.utcnow()
        return state
