"""Crawl4AI 库级集成 — 直接在进程中调用浏览器爬虫，无需单独启动服务。"""
from __future__ import annotations

import asyncio
import importlib.util
import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent
VENV_PYTHON = PROJECT_ROOT / ".venv" / "Scripts" / "python.exe"
VENV_PIP = PROJECT_ROOT / ".venv" / "Scripts" / "pip.exe"
VENV_SETUP = PROJECT_ROOT / ".venv" / "Scripts" / "crawl4ai-setup.exe"
VENV_DOCTOR = PROJECT_ROOT / ".venv" / "Scripts" / "crawl4ai-doctor.exe"


def is_crawl4ai_installed() -> bool:
    return importlib.util.find_spec("crawl4ai") is not None


def ensure_crawl4ai_installed() -> tuple[bool, str | None]:
    """确保当前项目 .venv 中已安装 crawl4ai。
    返回 (ok, message)。失败时不抛异常。"""
    if is_crawl4ai_installed():
        return True, None
    if not VENV_PIP.exists():
        return False, f"未找到项目 pip: {VENV_PIP}"
    try:
        subprocess.run([str(VENV_PIP), "install", "-U", "crawl4ai"], check=True, timeout=300)
        if VENV_SETUP.exists():
            subprocess.run([str(VENV_SETUP)], check=True, timeout=600)
        return True, None
    except Exception as e:
        return False, str(e)


def crawl4ai_health() -> dict:
    """返回 crawl4ai 集成状态。"""
    installed = is_crawl4ai_installed()
    return {
        "installed": installed,
        "python": str(VENV_PYTHON),
        "pip": str(VENV_PIP),
        "setup": str(VENV_SETUP),
        "doctor": str(VENV_DOCTOR),
    }


async def crawl_url(
    url: str,
    word_count_threshold: int = 100,
    remove_overlay_elements: bool = True,
    timeout: int = 60,
) -> dict:
    try:
        from crawl4ai import AsyncWebCrawler

        async with AsyncWebCrawler(verbose=False) as crawler:
            result = await crawler.arun(
                url=url,
                word_count_threshold=word_count_threshold,
                remove_overlay_elements=remove_overlay_elements,
                bypass_cache=True,
            )
            if result.success:
                return {
                    "success": True,
                    "url": url,
                    "markdown": getattr(result, "markdown", "") or "",
                    "html": getattr(result, "html", "") or "",
                    "title": (
                        getattr(result, "metadata", {})
                        .get("title", "") if hasattr(result, "metadata") else ""
                    ),
                    "error": None,
                }
            return {
                "success": False,
                "url": url,
                "markdown": "",
                "error": f"Crawl4AI failed: {getattr(result, 'error_message', 'unknown')}",
            }
    except ImportError:
        return {
            "success": False,
            "url": url,
            "markdown": "",
            "error": "crawl4ai 未安装（已支持启动时自动安装）",
        }
    except Exception as e:
        return {
            "success": False,
            "url": url,
            "markdown": "",
            "error": str(e),
        }


async def crawl_urls_batch(urls: list[str], timeout: int = 120) -> list[dict]:
    batch = urls[:10]
    tasks = [crawl_url(url, timeout=timeout) for url in batch]
    return await asyncio.gather(*tasks, return_exceptions=True)
