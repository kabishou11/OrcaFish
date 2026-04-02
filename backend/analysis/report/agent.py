from __future__ import annotations
"""OrcaFish ReportAgent — assembles multi-engine reports into final HTML."""
import re
from datetime import datetime
from dataclasses import dataclass, field
from typing import Optional
from backend.llm.client import LLMClient


@dataclass
class ReportTask:
    """In-memory record of a report assembly task."""

    task_id: str
    query: str
    status: str = "pending"  # pending | processing | completed | failed
    progress: int = 0
    query_report: str = ""
    media_report: str = ""
    insight_report: str = ""
    final_html: str = ""
    error: str = ""
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

    def touch(self):
        self.updated_at = datetime.utcnow()


class ReportAgent:
    """
    Assembles reports from QueryAgent, MediaAgent, and InsightAgent
    into a final HTML document.

    Ported from BettaFish ReportEngine/agent.py ReportAgent architecture.

    Pipeline:
      1. Collect markdown reports from all three engines.
      2. Call LLM to synthesize a unified narrative (ASSEMBLY_PROMPT).
      3. Render the result as styled HTML (HTML_TEMPLATE).
    """

    # ------------------------------------------------------------------
    # Prompt library
    # ------------------------------------------------------------------

    ASSEMBLY_PROMPT = """你是一个专业的舆情报告整合专家。
根据以下三份子报告，整合成一份完整的舆情分析报告。

主题：{query}

--- 网络新闻分析（QueryAgent）---
{query_report}

--- 多媒体内容分析（MediaAgent）---
{media_report}

--- 社交媒体洞察（InsightAgent）---
{insight_report}

要求：
1. 综合三个来源的信息，突出重点和关键发现
2. 使用Markdown格式输出
3. 结构清晰：摘要、主体分析、结论
4. 字数3000-5000字
5. 使用中文撰写"""

    # ------------------------------------------------------------------
    # HTML template (dark-mode, modern design)
    # ------------------------------------------------------------------

    HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
  :root {{
    --bg: #0f172a;
    --surface: #1e293b;
    --surface2: #283548;
    --text: #f1f5f9;
    --text-muted: #94a3b8;
    --accent: #3b82f6;
    --accent-light: #60a5fa;
    --border: #334155;
    --tag-query-bg: #1d4ed8;
    --tag-media-bg: #7c3aed;
    --tag-insight-bg: #059669;
    --tag-width: 80px;
  }}
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.75;
    padding: 2rem 1rem;
  }}
  .container {{ max-width: 900px; margin: 0 auto; }}

  /* Hero */
  .hero {{
    background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 2.5rem 3rem;
    margin-bottom: 2rem;
    position: relative;
    overflow: hidden;
  }}
  .hero::before {{
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; height: 3px;
    background: linear-gradient(90deg, var(--accent), #8b5cf6, #10b981);
  }}
  .hero h1 {{ font-size: 1.75rem; font-weight: 700; color: var(--accent-light); margin-bottom: 0.75rem; line-height: 1.3; }}
  .hero .meta {{ font-size: 0.8rem; color: var(--text-muted); }}
  .hero .meta span {{ margin-right: 1.5rem; }}

  /* Progress bar */
  .progress-bar {{
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem 1.5rem;
    margin-bottom: 1.5rem;
    font-size: 0.85rem;
    color: var(--text-muted);
  }}
  .progress-track {{
    background: var(--border);
    border-radius: 4px;
    height: 6px;
    margin-top: 0.5rem;
    overflow: hidden;
  }}
  .progress-fill {{
    height: 100%;
    background: linear-gradient(90deg, var(--accent), #8b5cf6);
    border-radius: 4px;
    transition: width 0.4s ease;
  }}

  /* Source tags */
  .source-tags {{ margin-bottom: 1.5rem; display: flex; gap: 0.5rem; flex-wrap: wrap; }}
  .source-tag {{
    display: inline-block;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.2rem 0.6rem;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }}
  .tag-query {{ background: var(--tag-query-bg); color: #fff; }}
  .tag-media {{ background: var(--tag-media-bg); color: #fff; }}
  .tag-insight {{ background: var(--tag-insight-bg); color: #fff; }}

  /* Sections */
  .section {{
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.5rem 2rem;
    margin-bottom: 1rem;
  }}
  .section h2 {{
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--accent-light);
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }}

  /* Content typography */
  .content {{ font-size: 0.95rem; line-height: 1.8; }}
  .content h1 {{ font-size: 1.5rem; color: var(--accent-light); margin: 1.5rem 0 0.75rem; }}
  .content h2 {{ font-size: 1.2rem; color: #93c5fd; margin: 1.5rem 0 0.5rem; }}
  .content h3 {{ font-size: 1rem; color: #bfdbfe; margin: 1.25rem 0 0.4rem; }}
  .content p {{ margin-bottom: 1rem; }}
  .content ul, .content ol {{ margin: 0.75rem 0 1rem 1.5rem; }}
  .content li {{ margin-bottom: 0.35rem; }}
  .content strong {{ color: #e2e8f0; }}
  .content em {{ color: #cbd5e1; font-style: italic; }}
  .content a {{ color: var(--accent-light); text-decoration: none; }}
  .content a:hover {{ text-decoration: underline; }}
  .content blockquote {{
    border-left: 3px solid var(--accent);
    padding-left: 1rem;
    color: var(--text-muted);
    margin: 1rem 0;
  }}
  .content code {{
    background: var(--surface2);
    padding: 0.15rem 0.35rem;
    border-radius: 3px;
    font-size: 0.875em;
  }}
  .content pre {{
    background: var(--surface2);
    border-radius: 8px;
    padding: 1rem;
    overflow-x: auto;
    margin: 1rem 0;
  }}
  .content pre code {{ background: none; padding: 0; }}

  /* Summary box */
  .summary-box {{
    background: linear-gradient(135deg, #1e3a5f, #172554);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.5rem 2rem;
    margin-bottom: 1.5rem;
  }}
  .summary-box h2 {{ color: var(--accent-light); margin-bottom: 0.75rem; }}

  /* Footer */
  .footer {{
    text-align: center;
    color: #475569;
    font-size: 0.78rem;
    margin-top: 2.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }}
  .footer .powered {{ color: #64748b; }}

  /* Responsive */
  @media (max-width: 600px) {{
    .hero {{ padding: 1.5rem; }}
    .hero h1 {{ font-size: 1.4rem; }}
    .section {{ padding: 1rem 1.25rem; }}
  }}
</style>
</head>
<body>
<div class="container">
  <div class="hero">
    <h1>{title}</h1>
    <div class="meta">
      <span>生成时间：{timestamp}</span>
      <span>OrcaFish 统一情报系统</span>
    </div>
  </div>

  <div class="progress-bar">
    <div>报告生成进度</div>
    <div class="progress-track">
      <div class="progress-fill" style="width: {progress}%"></div>
    </div>
  </div>

  <div class="source-tags">
    <span class="source-tag tag-query">QueryAgent</span>
    <span class="source-tag tag-media">MediaAgent</span>
    <span class="source-tag tag-insight">InsightAgent</span>
  </div>

  <div class="content">
    {content}
  </div>

  <div class="footer">
    <div class="powered">由 OrcaFish 提供 &middot; AI 辅助分析 &middot; 仅供参考</div>
  </div>
</div>
</body>
</html>"""

    # ------------------------------------------------------------------
    # Init
    # ------------------------------------------------------------------

    def __init__(self, llm_client: LLMClient):
        self.llm = llm_client
        self._tasks: dict[str, ReportTask] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def generate(
        self,
        task_id: str,
        query: str,
        query_report: str = "",
        media_report: str = "",
        insight_report: str = "",
    ) -> str:
        """
        Generate a final HTML report by assembling three sub-reports.

        Args:
            task_id: Unique identifier for this assembly task.
            query: The original research query.
            query_report: Markdown output from QueryAgent.
            media_report: Markdown output from MediaAgent.
            insight_report: Markdown output from InsightAgent.

        Returns:
            Rendered HTML string.
        """
        task = ReportTask(
            task_id=task_id,
            query=query,
            status="processing",
            query_report=query_report,
            media_report=media_report,
            insight_report=insight_report,
        )
        self._tasks[task_id] = task

        try:
            # --- Step 1: LLM synthesis ---
            assembled = await self.llm.invoke(
                system_prompt="你是一个专业的舆情报告整合专家。",
                user_prompt=self.ASSEMBLY_PROMPT.format(
                    query=query,
                    query_report=self._truncate(query_report, 3000) if query_report else "（暂无数据）",
                    media_report=self._truncate(media_report, 3000) if media_report else "（暂无数据）",
                    insight_report=self._truncate(insight_report, 3000) if insight_report else "（暂无数据）",
                ),
                max_tokens=8192,
            )

            # --- Step 2: Convert markdown → HTML ---
            html_content = self._markdown_to_html(assembled)
            progress = 100

            task.status = "completed"
            task.progress = progress
            task.final_html = self.HTML_TEMPLATE.format(
                title=f"舆情分析报告：{query}",
                timestamp=datetime.utcnow().strftime("%Y-%m-%d %H:%M"),
                progress=progress,
                content=html_content,
            )
            task.touch()
            return task.final_html

        except Exception as e:
            task.status = "failed"
            task.error = str(e)
            task.touch()
            raise

    def get_task(self, task_id: str) -> Optional[ReportTask]:
        """Retrieve a task by ID."""
        return self._tasks.get(task_id)

    # ------------------------------------------------------------------
    # Markdown → HTML converter
    # ------------------------------------------------------------------

    def _markdown_to_html(self, md: str) -> str:
        """
        Minimal safe markdown-to-HTML converter.
        Handles: headings, paragraphs, lists, bold/italic, inline code, blockquotes.
        """
        lines = md.split("\n")
        html_lines: list[str] = []
        i = 0

        while i < len(lines):
            line = lines[i]
            stripped = line.strip()

            # Blank line — close open blocks
            if not stripped:
                html_lines.append("")
                i += 1
                continue

            # Headings
            m = re.match(r"^(#{1,6})\s+(.*)", stripped)
            if m:
                level = len(m.group(1))
                text = self._inline_format(m.group(2))
                html_lines.append(f"<h{level}>{text}</h{level}>")
                i += 1
                continue

            # Blockquote
            if stripped.startswith(">"):
                content = self._inline_format(stripped.lstrip("> ").replace("&gt;", ""))
                html_lines.append(f"<blockquote>{content}</blockquote>")
                i += 1
                continue

            # Unordered list
            if re.match(r"^[-*+]\s+", stripped):
                items = []
                while i < len(lines) and re.match(r"^[-*+]\s+(.*)", lines[i].strip()):
                    m2 = re.match(r"^[-*+]\s+(.*)", lines[i].strip())
                    items.append(self._inline_format(m2.group(1)))
                    i += 1
                list_items = "".join(f"<li>{item}</li>" for item in items)
                html_lines.append(f"<ul>{list_items}</ul>")
                continue

            # Ordered list
            if re.match(r"^\d+\.\s+", stripped):
                items = []
                while i < len(lines) and re.match(r"^\d+\.\s+(.*)", lines[i].strip()):
                    m2 = re.match(r"^\d+\.\s+(.*)", lines[i].strip())
                    items.append(self._inline_format(m2.group(1)))
                    i += 1
                list_items = "".join(f"<li>{item}</li>" for item in items)
                html_lines.append(f"<ol>{list_items}</ol>")
                continue

            # Fenced code block
            if stripped.startswith("```"):
                code_lines = []
                i += 1
                while i < len(lines) and not lines[i].strip().startswith("```"):
                    escaped = (
                        lines[i]
                        .replace("&", "&amp;")
                        .replace("<", "&lt;")
                        .replace(">", "&gt;")
                    )
                    code_lines.append(escaped)
                    i += 1
                code = "\n".join(code_lines)
                html_lines.append(f"<pre><code>{code}</code></pre>")
                i += 1  # skip closing fence
                continue

            # Paragraph
            html_lines.append(f"<p>{self._inline_format(stripped)}</p>")
            i += 1

        return "\n".join(html_lines)

    @staticmethod
    def _inline_format(text: str) -> str:
        """Apply inline formatting: bold, italic, code, links."""
        # Code spans
        text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
        # Bold
        text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        text = re.sub(r"__(.+?)__", r"<strong>\1</strong>", text)
        # Italic
        text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)
        text = re.sub(r"_(.+?)_", r"<em>\1</em>", text)
        # Links
        text = re.sub(
            r"\[([^\]]+)\]\((https?://[^\)]+)\)", r'<a href="\2" target="_blank" rel="noopener">\1</a>', text
        )
        return text

    @staticmethod
    def _truncate(text: str, max_chars: int) -> str:
        """Truncate text to max_chars, breaking at word boundaries."""
        if len(text) <= max_chars:
            return text
        cut = text[:max_chars]
        last_ws = cut.rfind(" ")
        if last_ws > max_chars * 0.7:
            cut = cut[:last_ws]
        return cut + "…"
