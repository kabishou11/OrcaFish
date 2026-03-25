"""OrcaFish DeepSearchAgent Base — ported from BettaFish QueryEngine/agent.py"""
import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
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
class AgentState:
    """Full research session state."""

    query: str
    report_title: str = ""
    paragraphs: list[Paragraph] = field(default_factory=list)
    final_report: str = ""
    is_completed: bool = False
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)


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

        # Step 3: Format final report
        state.final_report = await self._format_report(state)
        state.is_completed = True
        state.updated_at = datetime.utcnow()
        return state
