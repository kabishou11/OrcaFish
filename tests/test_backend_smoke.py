from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


async def _run_smoke() -> None:
    from backend.main import health_check
    from backend.api.routes.intelligence import get_cii_scores, get_wm_status
    from backend.api.routes.pipeline import list_pipelines
    from backend.api.routes.analysis import trigger_analysis, get_analysis_task, AnalysisRequest
    from backend.api.routes.simulation import (
        create_run,
        get_run_status,
        get_run_detail,
        get_simulation_report,
    )
    from backend.models.simulation import SimulationCreateRequest

    async def fake_agent_team(task_id: str, query: str) -> dict[str, str]:
        return {"task_id": task_id, "query": query}

    def fake_create_task(coro):
        coro.close()
        return None

    with (
        patch("backend.main._is_zep_ce_running", return_value=False),
        patch("backend.main.crawl4ai_health", return_value={"installed": True, "ready": True}),
        patch("backend.api.routes.analysis._run_agent_team", fake_agent_team),
        patch("backend.api.routes.analysis.asyncio.create_task", side_effect=fake_create_task),
    ):
        health = await health_check()
        assert health["status"] == "healthy"

        wm = await get_wm_status()
        assert "running" in wm

        cii = await get_cii_scores()
        assert isinstance(cii.get("scores"), dict)

        pipelines = await list_pipelines()
        assert isinstance(pipelines.get("pipelines"), list)

        analysis = await trigger_analysis(AnalysisRequest(query="台海局势升级后的舆论演化"))
        assert analysis["status"] == "running"

        analysis_status = await get_analysis_task(analysis["task_id"])
        assert analysis_status["status"] == "running"

        run = await create_run(
            SimulationCreateRequest(
                name="烟雾测试推演",
                seed_content="测试议题：台海局势升级后的舆论扩散。",
                simulation_requirement="观察主要叙事阵营与升级路径。",
                max_rounds=3,
            )
        )
        assert run["status"] == "created"

        status = await get_run_status(run["run_id"])
        assert status["status"] == "created"

        detail = await get_run_detail(run["run_id"])
        assert isinstance(detail.get("all_actions"), list)

        report = await get_simulation_report(run["run_id"])
        assert "html_content" in report


def test_core_backend_routes_smoke() -> None:
    asyncio.run(_run_smoke())
    _run_config_checks()


def _run_config_checks() -> None:
    from backend.config import Settings
    from backend.llm.client import LLMClient
    from backend.api.routes.simulation import router as simulation_router

    old_values = {key: os.environ.get(key) for key in [
        "QUERY_LLM_PROVIDER",
        "QUERY_LLM_API_KEY",
        "QUERY_LLM_BASE_URL",
        "QUERY_LLM_MODEL",
        "QUERY_LLM_REASONING_SPLIT",
        "QUERY_LLM__API_KEY",
        "MODELSCOPE_API_KEY",
        "MINIMAX_API_KEY",
    ]}

    try:
        os.environ["QUERY_LLM_PROVIDER"] = "minimax"
        os.environ["QUERY_LLM_API_KEY"] = "flat-key"
        os.environ["QUERY_LLM_BASE_URL"] = "https://api.minimaxi.com/v1"
        os.environ["QUERY_LLM_MODEL"] = "MiniMax-M2.7"
        os.environ["QUERY_LLM_REASONING_SPLIT"] = "true"
        flat_settings = Settings(_env_file=None)
        assert flat_settings.query_llm.provider == "minimax"
        assert flat_settings.query_llm.api_key == "flat-key"
        assert flat_settings.query_llm.reasoning_split is True

        os.environ.pop("QUERY_LLM_API_KEY", None)
        os.environ["QUERY_LLM__API_KEY"] = "nested-key"
        nested_settings = Settings(_env_file=None)
        assert nested_settings.query_llm.api_key == "nested-key"

        os.environ["MODELSCOPE_API_KEY"] = "ms-key"
        os.environ["MINIMAX_API_KEY"] = "mm-key"
        minimax_client = LLMClient(provider="minimax", api_key="", model="MiniMax-M2.7")
        assert minimax_client.api_key == "mm-key"

        graph_paths = {route.path for route in simulation_router.routes}
        assert "/simulation/runs/{run_id}/graph" in graph_paths
    finally:
        for key, value in old_values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if __name__ == "__main__":
    asyncio.run(_run_smoke())
    _run_config_checks()
    print("backend-smoke-ok")
