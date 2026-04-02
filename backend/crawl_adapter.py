"""Crawl4AI 本地服务适配层

后端通过 HTTP 调用 Crawl4AI FastAPI 服务（默认 http://localhost:11235）。
支持功能：
- URL 列表 → Markdown 正文
- 异常自动降级（服务不可用时返回空列表，不阻断主流程）
"""
from __future__ import annotations

import httpx
from typing import Any


def _get_client(timeout: float = 30.0) -> httpx.Client:
    return httpx.Client(timeout=timeout)


def fetch_markdown(urls: list[str], base_url: str = "http://localhost:11235") -> list[dict[str, Any]]:
    """调用 Crawl4AI /md 接口，将 URL 列表转为 Markdown。

    Args:
        urls: 待抓取的 URL 列表
        base_url: Crawl4AI 服务地址，默认 localhost:11235

    Returns:
        [{url, markdown, status, error}, ...]
        每次调用返回顺序与输入 urls 对应；
        抓取失败时 markdown=""，error 包含原因字符串。
    """
    if not urls:
        return []

    try:
        with _get_client(timeout=60.0) as client:
            resp = client.post(
                f"{base_url.rstrip('/')}/md",
                json={"urls": urls},
            )
            if resp.is_success:
                data = resp.json()
                # /md 返回格式: { "results": [{url, markdown, status, error}, ...] }
                return data.get("results", [])
    except Exception as e:
        pass

    # 服务不可用时，返回空结果降级（不阻断主流程）
    return [{"url": u, "markdown": "", "status": "unavailable", "error": str(e)} for u in urls]


def fetch_markdown_simple(
    url: str,
    base_url: str = "http://localhost:11235",
) -> str:
    """单 URL 简化接口，直接返回 markdown 字符串。

    抓取失败返回空字符串，调用方无需处理异常。
    """
    results = fetch_markdown([url], base_url=base_url)
    if results:
        return results[0].get("markdown", "")
    return ""
