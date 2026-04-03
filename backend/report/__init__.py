"""
Report Engine package.

这里避免在包导入阶段直接加载旧版 `agent.py`，因为当前后端只需要
`backend.report.api` 路由即可启动；延迟导入可以避免历史迁移残留阻塞
FastAPI 应用入口。
"""

from __future__ import annotations

from typing import Any

__version__ = "1.0.0"
__author__ = "Report Engine Team"

__all__ = ["ReportAgent", "create_agent"]


def __getattr__(name: str) -> Any:
    if name in {"ReportAgent", "create_agent"}:
        from .agent import ReportAgent, create_agent

        exports = {
            "ReportAgent": ReportAgent,
            "create_agent": create_agent,
        }
        return exports[name]

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
