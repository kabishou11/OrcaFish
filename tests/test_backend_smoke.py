from __future__ import annotations

import asyncio
import html
import os
import sys
import time
from pathlib import Path
from datetime import datetime
from types import SimpleNamespace
from typing import Dict, Union
from unittest.mock import AsyncMock, patch
import uuid

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


async def _run_smoke() -> None:
    from backend.main import health_check
    from backend.api.routes.intelligence import get_cii_scores, get_wm_status, get_news, get_country_context, start_wm, stop_wm
    from backend.api.routes.pipeline import list_pipelines
    from backend.api.routes.analysis import trigger_analysis, get_analysis_task, AnalysisRequest
    from backend.api.routes.graph import search_graph as search_graph_route
    from backend.api.routes.simulation import (
        _run_registry,
        create_run,
        delete_run,
        get_run_detail,
        get_run_status,
        get_simulation_report,
        start_run,
        stop_run,
    )
    from backend.models.simulation import SimulationCreateRequest

    async def fake_agent_team(task_id: str, query: str) -> Dict[str, str]:
        return {"task_id": task_id, "query": query}

    def fake_create_task(coro):
        coro.close()
        return None

    with patch("backend.main._is_zep_ce_running", return_value=False), \
        patch("backend.main.crawl4ai_health", return_value={"installed": True, "ready": True}), \
        patch("backend.api.routes.analysis._run_agent_team", fake_agent_team), \
        patch("backend.api.routes.analysis.asyncio.create_task", side_effect=fake_create_task):
        health = await health_check()
        assert health["status"] == "healthy"

        wm = await get_wm_status()
        assert "running" in wm

        try:
            await start_wm()
            country_context = await get_country_context("IR")
            assert country_context["iso"] == "IR"
            assert "country" in country_context
            assert "monitor" in country_context
            assert country_context["summary"]["signal_count"] >= 0
            assert isinstance(country_context["news"]["items"], list)
            assert isinstance(country_context["signals"]["items"], list)
            assert isinstance(country_context["focal_points"]["items"], list)
        finally:
            await stop_wm()

        cii = await get_cii_scores()
        assert isinstance(cii.get("scores"), dict)

        news = await get_news(limit=10)
        assert isinstance(news.get("items"), list)

        pipelines = await list_pipelines()
        assert isinstance(pipelines.get("pipelines"), list)

        analysis = await trigger_analysis(AnalysisRequest(query="台海局势升级后的舆论演化"))
        assert analysis["status"] == "running"

        analysis_status = await get_analysis_task(analysis["task_id"])
        assert analysis_status["status"] == "running"

        malicious_title = '<script>alert("xss")</script> 测试议题'
        run = await create_run(
            SimulationCreateRequest(
                name=malicious_title,
                seed_content="常规种子内容",
                simulation_requirement="观察主要叙事阵营与升级路径。",
                max_rounds=3,
                country_context={
                    "iso": "IR",
                    "country_name": "伊朗",
                    "score": 82.1,
                    "level": "high",
                },
                graph_context={
                    "graph_id": "analysis-graph-1",
                    "graph_source_mode": "remote_search",
                    "graph_queries": ["伊朗 冲突"],
                    "graph_facts": ["伊朗相关议题正在升温"],
                },
            )
        )
        assert run["status"] == "created"
        assert run["country_context"]["iso"] == "IR"
        assert run["graph_context"]["graph_id"] == "analysis-graph-1"

        status = await get_run_status(run["run_id"])
        assert status["status"] == "created"

        detail = await get_run_detail(run["run_id"])
        assert isinstance(detail.get("all_actions"), list)

        graph_search = await search_graph_route(run["graph_id"], query="常规 种子 内容", limit=5, scope="both")
        assert "facts" in graph_search
        assert "source_mode" in graph_search

        report = await get_simulation_report(run["run_id"])
        assert "html_content" in report
        assert malicious_title not in report["html_content"]
        assert html.escape(malicious_title) in report["html_content"]

        original_seed = run["seed_content"]
        _run_registry[run["run_id"]]["seed_content"] = "tampered-seed"

        captured: Dict[str, Union[str, int, bool]] = {}

        def fake_simulation_request(**kwargs):
            captured.update(kwargs)
            return SimpleNamespace(**kwargs)

        _run_registry[run["run_id"]]["status"] = "created"
        with patch("backend.api.routes.simulation.SimulationCreateRequest", side_effect=fake_simulation_request):
            with patch("backend.api.routes.simulation._CREATE_TASK", side_effect=fake_create_task):
                started = await start_run(run["run_id"])

        assert started["status"] == "running"
        assert captured["seed_content"] == original_seed
        assert captured["simulation_requirement"] == run["simulation_requirement"]
        assert captured["max_rounds"] == run["max_rounds"]
        assert captured["enable_twitter"] is True
        assert captured["enable_reddit"] is True
        assert captured["country_context"]["iso"] == "IR"
        assert captured["graph_context"]["graph_id"] == "analysis-graph-1"

        toggle_run = await create_run(
            SimulationCreateRequest(
                name="平台开关测试",
                seed_content="测试平台开关",
                simulation_requirement="验证平台开关是否生效。",
                max_rounds=2,
                enable_twitter=False,
                enable_reddit=True,
            )
        )
        toggle_status = await start_run(toggle_run["run_id"])
        assert toggle_status["status"] == "running"

        for _ in range(20):
            current = await get_run_status(toggle_run["run_id"])
            if current["status"] == "completed":
                break
            await asyncio.sleep(0.1)

        toggle_detail = await get_run_detail(toggle_run["run_id"])
        for _ in range(20):
            if toggle_detail["all_actions"]:
                break
            await asyncio.sleep(0.1)
            toggle_detail = await get_run_detail(toggle_run["run_id"])
        assert toggle_detail["all_actions"]
        assert all(action.get("platform") == "reddit" for action in toggle_detail["all_actions"])
        final_toggle_status = await get_run_status(toggle_run["run_id"])
        assert final_toggle_status["status"] == "completed"
        assert final_toggle_status["twitter_completed"] is True
        assert final_toggle_status["twitter_current_round"] == final_toggle_status["total_rounds"]
        assert final_toggle_status["reddit_completed"] is True

        stop_run_data = await create_run(
            SimulationCreateRequest(
                name="暂停测试",
                seed_content="测试停止语义",
                simulation_requirement="验证暂停后不再推进。",
                max_rounds=6,
            )
        )
        await start_run(stop_run_data["run_id"])
        for _ in range(20):
            current = await get_run_status(stop_run_data["run_id"])
            if current["current_round"] > 0:
                break
            await asyncio.sleep(0.05)

        paused = await stop_run(stop_run_data["run_id"])
        assert paused["status"] == "paused"
        paused_status = await get_run_status(stop_run_data["run_id"])
        paused_detail = await get_run_detail(stop_run_data["run_id"])
        paused_round = paused_status["current_round"]
        paused_actions = len(paused_detail["all_actions"])

        await asyncio.sleep(0.3)

        frozen_status = await get_run_status(stop_run_data["run_id"])
        frozen_detail = await get_run_detail(stop_run_data["run_id"])
        assert frozen_status["status"] == "paused"
        assert frozen_status["current_round"] == paused_round
        assert len(frozen_detail["all_actions"]) == paused_actions



def test_core_backend_routes_smoke() -> None:
    asyncio.run(_run_smoke())
    _run_config_checks()


async def _assert_status_prefers_stop_requested() -> None:
    from backend.api.routes.simulation import _run_registry, create_run, get_run_status
    from backend.models.simulation import SimulationCreateRequest

    run = await create_run(
        SimulationCreateRequest(
            name="status-priority",
            seed_content="验证显式暂停优先级",
            simulation_requirement="stop 后状态接口必须保持 paused。",
            max_rounds=4,
        )
    )
    run_id = run["run_id"]
    simulation_id = run["simulation_id"]
    _run_registry[run_id]["status"] = "running"
    _run_registry[run_id]["stop_requested"] = True
    _run_registry[run_id]["started_at"] = "2026-04-09T00:00:00"

    runner_statuses = [
        SimpleNamespace(status="running", current_round=2, total_rounds=4, recent_actions=[], is_mock=True),
        SimpleNamespace(status="completed", current_round=4, total_rounds=4, recent_actions=[], is_mock=True),
    ]

    with patch("backend.api.routes.simulation._RUNNER.get_status", new=AsyncMock(side_effect=runner_statuses)):
        first = await get_run_status(run_id)
        second = await get_run_status(run_id)

    assert first["status"] == "paused"
    assert second["status"] == "paused"
    assert first["current_round"] == 2
    assert second["current_round"] == 4
    assert _run_registry[run_id]["status"] == "paused"
    assert _run_registry[run_id]["simulation_id"] == simulation_id


async def _assert_background_stop_wins_near_completion() -> None:
    from backend.api.routes.simulation import _run_registry, _run_simulation_bg, create_run
    from backend.models.simulation import SimulationCreateRequest

    run = await create_run(
        SimulationCreateRequest(
            name="bg-stop-race",
            seed_content="验证 stop 与完成态竞争",
            simulation_requirement="后台任务接近完成时 stop 仍应落 paused。",
            max_rounds=3,
        )
    )
    run_id = run["run_id"]
    simulation_id = run["simulation_id"]

    async def fake_sleep(_: float) -> None:
        _run_registry[run_id]["stop_requested"] = True

    with patch("backend.api.routes.simulation._RUNNER.start", new=AsyncMock(return_value=None)), \
        patch(
            "backend.api.routes.simulation._RUNNER.get_status",
            new=AsyncMock(return_value=SimpleNamespace(status="completed", current_round=3, total_rounds=3, recent_actions=[], is_mock=True)),
        ), \
        patch("asyncio.sleep", new=fake_sleep):
        await _run_simulation_bg(
            run_id,
            simulation_id,
            SimulationCreateRequest(
                name="bg-stop-race",
                seed_content="验证 stop 与完成态竞争",
                simulation_requirement="后台任务接近完成时 stop 仍应落 paused。",
                max_rounds=3,
            ),
        )

    assert _run_registry[run_id]["status"] == "paused"
    assert _run_registry[run_id]["stop_requested"] is True
    assert _run_registry[run_id]["rounds_completed"] == 3
    assert _run_registry[run_id]["convergence_achieved"] is False
    assert _run_registry[run_id]["duration_ms"] is not None



def test_run_status_prefers_explicit_pause() -> None:
    asyncio.run(_assert_status_prefers_stop_requested())


async def _assert_restarted_run_status_stays_running() -> None:
    from backend.api.routes.simulation import _run_registry, create_run, get_run_status, start_run
    from backend.models.simulation import SimulationCreateRequest

    run = await create_run(
        SimulationCreateRequest(
            name="restart-status-regression",
            seed_content="验证 paused restart 后立即查询状态",
            simulation_requirement="restart 后 status 不应回落为 paused。",
            max_rounds=4,
        )
    )
    run_id = run["run_id"]
    _run_registry[run_id]["status"] = "paused"
    _run_registry[run_id]["stop_requested"] = True
    _run_registry[run_id]["rounds_completed"] = 2

    def fake_create_task(coro):
        coro.close()
        return None

    with patch("backend.api.routes.simulation._CREATE_TASK", side_effect=fake_create_task):
        restarted = await start_run(run_id)

    assert restarted["status"] == "running"
    assert _run_registry[run_id]["stop_requested"] is False

    runner_statuses = [
        SimpleNamespace(status="unknown", current_round=0, total_rounds=4, recent_actions=[], is_mock=True),
        SimpleNamespace(status="paused", current_round=0, total_rounds=4, recent_actions=[], is_mock=True),
    ]
    with patch("backend.api.routes.simulation._RUNNER.get_status", new=AsyncMock(side_effect=runner_statuses)):
        first = await get_run_status(run_id)
        second = await get_run_status(run_id)

    assert first["status"] == "running"
    assert second["status"] == "running"
    assert first["current_round"] == 0
    assert second["current_round"] == 0
    assert _run_registry[run_id]["status"] == "running"


async def _assert_late_stop_does_not_override_completed() -> None:
    from backend.api.routes.simulation import _RUNNER, _run_registry, create_run, stop_run
    from backend.models.simulation import SimulationCreateRequest

    run = await create_run(
        SimulationCreateRequest(
            name="late-stop-regression",
            seed_content="验证 completed 后迟到 stop",
            simulation_requirement="completed 后 stop 不应改写终态。",
            max_rounds=2,
        )
    )
    run_id = run["run_id"]
    _run_registry[run_id]["status"] = "completed"
    _run_registry[run_id]["stop_requested"] = False
    _run_registry[run_id]["rounds_completed"] = 2

    with patch.object(_RUNNER, "stop", new=AsyncMock()) as stop_mock:
        stopped = await stop_run(run_id)

    assert stopped["status"] == "completed"
    assert _run_registry[run_id]["status"] == "completed"
    assert _run_registry[run_id]["stop_requested"] is False
    stop_mock.assert_not_awaited()



def test_run_status_stays_running_right_after_restart() -> None:
    asyncio.run(_assert_restarted_run_status_stays_running())



def test_late_stop_does_not_override_completed_status() -> None:
    asyncio.run(_assert_late_stop_does_not_override_completed())


async def _assert_runner_completes_without_failed_regression() -> None:
    import tempfile

    from backend.simulation.oasis_runner import OASISRunner

    with tempfile.TemporaryDirectory() as tmpdir:
        runner = OASISRunner(data_dir=tmpdir)
        simulation_id = f"sim_completed_regression_{uuid.uuid4().hex[:8]}"
        sim_id, sim_dir = runner.create_simulation(
            {
                "simulation_id": simulation_id,
                "seed_content": "验证正常完成必须落 completed",
                "time_config": {"total_rounds": 1},
            }
        )

        started = await runner.start(sim_id, sim_dir, max_rounds=1, enable_twitter=False, enable_reddit=True)
        assert started.status == "running"

        for _ in range(30):
            status = await runner.get_status(sim_id)
            if status.status == "completed":
                break
            assert status.status != "failed"
            await asyncio.sleep(0.05)

        final_status = await runner.get_status(sim_id)
        assert final_status.status == "completed"
        assert final_status.current_round == 1
        assert final_status.total_rounds == 1



def test_oasis_runner_completed_regression() -> None:
    asyncio.run(_assert_runner_completes_without_failed_regression())



async def _assert_runner_can_restart_from_paused() -> None:
    import tempfile

    from backend.simulation.oasis_runner import OASISRunner

    with tempfile.TemporaryDirectory() as tmpdir:
        runner = OASISRunner(data_dir=tmpdir)
        simulation_id = f"sim_paused_restart_regression_{uuid.uuid4().hex[:8]}"
        sim_id, sim_dir = runner.create_simulation(
            {
                "simulation_id": simulation_id,
                "seed_content": "验证 paused 后允许重新启动",
                "time_config": {"total_rounds": 2},
            }
        )

        started = await runner.start(sim_id, sim_dir, max_rounds=2, enable_twitter=False, enable_reddit=True)
        assert started.status == "running"

        for _ in range(30):
            status = await runner.get_status(sim_id)
            if status.current_round > 0:
                break
            await asyncio.sleep(0.05)

        stopped = await runner.stop(sim_id)
        assert stopped is True
        paused_status = await runner.get_status(sim_id)
        assert paused_status.status == "paused"

        restarted = await runner.start(sim_id, sim_dir, max_rounds=2, enable_twitter=False, enable_reddit=True)
        assert restarted.status == "running"
        assert restarted.current_round == 0

        for _ in range(40):
            final_status = await runner.get_status(sim_id)
            if final_status.status == "completed":
                break
            assert final_status.status != "failed"
            await asyncio.sleep(0.05)

        final_status = await runner.get_status(sim_id)
        assert final_status.status == "completed"
        assert final_status.current_round == 2



def test_oasis_runner_can_restart_from_paused() -> None:
    asyncio.run(_assert_runner_can_restart_from_paused())


async def _assert_analysis_team_does_not_wait_for_digest_before_finishing() -> None:
    from backend.api.routes import analysis as analysis_route
    from backend.models.analysis import AnalysisTask

    task_id = f"task_digest_nonblocking_{uuid.uuid4().hex[:8]}"
    task = AnalysisTask(
        task_id=task_id,
        query="台海局势升级后的舆论演化",
        status="running",
        progress=0,
        agent_status={"query": "queued", "media": "queued", "insight": "queued", "report": "queued"},
        agent_metrics=analysis_route._build_initial_agent_metrics(),
        matched_terms=analysis_route._extract_query_terms("台海局势升级后的舆论演化"),
        sections=analysis_route._build_initial_sections("台海局势升级后的舆论演化", analysis_route._extract_query_terms("台海局势升级后的舆论演化")),
        timeline=[],
        ui_message="测试中",
    )
    analysis_route._task_registry[task_id] = task

    class FakeLLMClient:
        def __init__(self, *args, **kwargs):
            pass

    async def fast_research(label: str):
        await asyncio.sleep(0.01)
        return SimpleNamespace(final_report=f"{label} live report")

    class FakeQueryAgent:
        def __init__(self, llm):
            self.llm = llm

        async def research(self, query: str):
            return await fast_research("query")

    class FakeMediaAgent:
        def __init__(self, llm):
            self.llm = llm

        async def research(self, query: str):
            return await fast_research("media")

    class FakeInsightAgent:
        def __init__(self, llm):
            self.llm = llm

        async def research(self, query: str):
            return await fast_research("insight")

    class FakeReportAgent:
        def __init__(self, llm):
            self.llm = llm
            self.calls = []

        async def generate(self, **kwargs):
            self.calls.append(kwargs)
            await asyncio.sleep(0.01)
            return "<html><body>ok</body></html>"

    def slow_digest(_: str):
        time.sleep(5.0)
        return [
            {
                "title": "延迟到达的监控摘要",
                "summary": "外部监控源很慢，但不该阻塞综合结论。",
                "source": "Delayed Monitor",
                "country": "GLOBAL",
                "published_at": "2026-04-12 13:50",
                "signal_type": "alert",
            }
        ]

    started_at = time.perf_counter()
    with patch("backend.llm.client.LLMClient", FakeLLMClient), \
        patch("backend.analysis.agents.query.QueryAgent", FakeQueryAgent), \
        patch("backend.analysis.agents.media.MediaAgent", FakeMediaAgent), \
        patch("backend.analysis.agents.insight.InsightAgent", FakeInsightAgent), \
        patch("backend.analysis.report.agent.ReportAgent", FakeReportAgent), \
        patch("backend.api.routes.analysis._build_fallback_news_digest", side_effect=slow_digest):
        results = await analysis_route._run_agent_team(task_id, task.query)
        elapsed = time.perf_counter() - started_at

    updated_task = analysis_route._task_registry[task_id]
    try:
        assert elapsed < 2.5
        assert results == {
            "query": "query live report",
            "media": "media live report",
            "insight": "insight live report",
        }
        assert updated_task.status == "completed"
        assert updated_task.progress == 100
        assert updated_task.final_report
        assert updated_task.html_report == "<html><body>ok</body></html>"
        assert updated_task.news_digest == []
        assert updated_task.agent_status["report"] == "done"
        assert updated_task.agent_metrics["report"].status == "done"
    finally:
        analysis_route._task_registry.pop(task_id, None)



def test_analysis_team_finishes_without_waiting_for_slow_digest() -> None:
    asyncio.run(_assert_analysis_team_does_not_wait_for_digest_before_finishing())


async def _assert_degraded_analysis_html_keeps_real_source_facts() -> None:
    from backend.api.routes import analysis as analysis_route
    from backend.analysis.agents.base import AgentState, Paragraph, SearchResult
    from backend.models.analysis import AnalysisTask

    task_id = f"task_source_fact_html_{uuid.uuid4().hex[:8]}"
    query = "台海局势升级后的舆论演化"
    task = AnalysisTask(
        task_id=task_id,
        query=query,
        status="running",
        progress=0,
        agent_status={"query": "queued", "media": "queued", "insight": "queued", "report": "queued"},
        agent_metrics=analysis_route._build_initial_agent_metrics(),
        matched_terms=analysis_route._extract_query_terms(query),
        sections=analysis_route._build_initial_sections(query, analysis_route._extract_query_terms(query)),
        timeline=[],
        ui_message="测试中",
    )
    analysis_route._task_registry[task_id] = task

    class FakeLLMClient:
        def __init__(self, *args, **kwargs):
            pass

    class FakeStateFactory:
        @staticmethod
        def build(title: str, source: str, url: str, summary: str, paragraph_title: str, published_at: str) -> AgentState:
            paragraph = Paragraph(title=paragraph_title, order=0)
            paragraph.add_result(
                SearchResult(
                    query=title,
                    url=url,
                    title=title,
                    content=summary,
                    score=0.9,
                    timestamp=datetime.fromisoformat(published_at),
                )
            )
            paragraph.latest_summary = f"{title} 摘要"
            paragraph.is_completed = True
            return AgentState(
                query=title,
                report_title=f"关于{title}的深度研究报告",
                paragraphs=[paragraph],
                final_report=f"## {source}\n\n{summary}",
            )

    class FakeQueryAgent:
        def __init__(self, llm):
            self.llm = llm

        async def research(self, query: str):
            return FakeStateFactory.build(
                title="台海军演进入新阶段",
                source="新华社",
                url="https://news.example.com/query",
                summary="公开报道提到多海域联动演训与外围部署变化。",
                paragraph_title="事件进展",
                published_at="2026-04-12T09:30:00",
            )

    class FakeMediaAgent:
        def __init__(self, llm):
            self.llm = llm

        async def research(self, query: str):
            raise RuntimeError("media unavailable")

    class FakeInsightAgent:
        def __init__(self, llm):
            self.llm = llm

        async def research(self, query: str):
            raise RuntimeError("insight unavailable")

    class FakeReportAgent:
        def __init__(self, llm):
            self.llm = llm

        async def generate(self, **kwargs):
            raise AssertionError("degraded path should skip report llm")

    def digest(_: str):
        return [
            {
                "title": "监控源提示区域热度继续上升",
                "summary": "监控新闻补充了外围平台热度与跨区域传播线索。",
                "source": "OrcaFish Monitor",
                "country": "TWN",
                "published_at": "2026-04-12 10:15",
                "signal_type": "alert",
            }
        ]

    with patch("backend.llm.client.LLMClient", FakeLLMClient), \
        patch("backend.analysis.agents.query.QueryAgent", FakeQueryAgent), \
        patch("backend.analysis.agents.media.MediaAgent", FakeMediaAgent), \
        patch("backend.analysis.agents.insight.InsightAgent", FakeInsightAgent), \
        patch("backend.analysis.report.agent.ReportAgent", FakeReportAgent), \
        patch("backend.api.routes.analysis._build_fallback_news_digest", side_effect=digest):
        await analysis_route._run_agent_team(task_id, query)

    updated_task = analysis_route._task_registry[task_id]
    try:
        assert updated_task.status == "degraded"
        assert updated_task.source_count >= 2
        assert "台海军演进入新阶段" in updated_task.final_report
        assert "新华社" in updated_task.final_report
        assert "2026-04-12 09:30" in updated_task.final_report
        assert "监控源提示区域热度继续上升" in updated_task.final_report
        assert "公开来源摘录" in updated_task.html_report
        assert "台海军演进入新阶段" in updated_task.html_report
        assert "2026-04-12 09:30" in updated_task.html_report
        assert "查看原始链接" in updated_task.html_report
        assert "https://news.example.com/query" in updated_task.html_report
    finally:
        analysis_route._task_registry.pop(task_id, None)



def test_degraded_analysis_html_keeps_real_source_facts() -> None:
    asyncio.run(_assert_degraded_analysis_html_keeps_real_source_facts())


async def _assert_delete_run_stops_runner() -> None:
    from backend.api.routes.simulation import _RUNNER, _run_registry, create_run, delete_run
    from backend.models.simulation import SimulationCreateRequest

    run = await create_run(
        SimulationCreateRequest(
            name="delete-stop-regression",
            seed_content="验证删除运行中记录时会停止后台 runner",
            simulation_requirement="delete run 时必须先停止后台 runner，避免残留任务。",
            max_rounds=3,
        )
    )
    run_id = run["run_id"]
    sim_id = run["simulation_id"]
    _run_registry[run_id]["status"] = "running"

    with patch.object(_RUNNER, "stop", new=AsyncMock(return_value=True)) as stop_mock:
        deleted = await delete_run(run_id)

    assert deleted == {"status": "deleted", "run_id": run_id}
    assert run_id not in _run_registry
    stop_mock.assert_awaited_once_with(sim_id)


async def _assert_run_graph_returns_graph_metadata() -> None:
    from backend.api.routes.simulation import _run_registry, create_run, get_run_graph
    from backend.models.simulation import SimulationCreateRequest

    provisioned_metadata = {
        "project_id": "graph-project-1",
        "graph_id": "graph-1",
        "graph_source": "graphiti",
        "graph_entity_count": 2,
        "graph_relation_count": 1,
        "graph_entity_types": ["Country"],
        "graph_synced_at": "2026-04-11T00:00:00+00:00",
    }
    refreshed_metadata = {
        "project_id": "graph-project-1",
        "graph_id": "graph-1",
        "graph_source": "graphiti",
        "graph_entity_count": 5,
        "graph_relation_count": 3,
        "graph_entity_types": ["Country", "Narrative"],
        "graph_synced_at": "2026-04-11T01:00:00+00:00",
    }

    with patch("backend.api.routes.simulation._provision_run_graph", return_value=provisioned_metadata):
        run = await create_run(
            SimulationCreateRequest(
                name="graph-route-metadata",
                seed_content="伊朗 美国 霍尔木兹海峡 局势升级",
                simulation_requirement="验证 graph route 返回图谱元数据。",
                max_rounds=2,
            )
        )

    with patch("backend.api.routes.simulation._refresh_run_graph_metadata", return_value=refreshed_metadata):
        graph = await get_run_graph(run["run_id"])

    assert graph["project_id"] == "graph-project-1"
    assert graph["graph_id"] == "graph-1"
    assert graph["graph_source"] == "graphiti"
    assert graph["graph_entity_count"] == len(graph["nodes"])
    assert graph["graph_relation_count"] == len(graph["edges"])
    assert set(graph["graph_entity_types"]) >= {"Country", "Narrative"}
    assert graph["graph_synced_at"] == "2026-04-11T01:00:00+00:00"
    assert isinstance(graph["nodes"], list)
    assert isinstance(graph["edges"], list)
    assert graph["nodes"]
    first_node = graph["nodes"][0]
    assert first_node["uuid"]
    assert first_node["labels"]
    assert isinstance(first_node["attributes"], dict)
    assert isinstance(first_node["properties"], dict)
    first_edge = graph["edges"][0]
    assert first_edge["uuid"]
    assert first_edge["name"]
    assert first_edge["fact"]
    assert first_edge["fact_type"]
    assert isinstance(first_edge["attributes"], dict)
    assert first_edge["source_node_uuid"]
    assert first_edge["target_node_uuid"]
    assert _run_registry[run["run_id"]]["graph_entity_count"] == len(graph["nodes"])
    assert _run_registry[run["run_id"]]["graph_relation_count"] == len(graph["edges"])


async def _assert_run_graph_gracefully_degrades_to_local_graph() -> None:
    from backend.api.routes.simulation import create_run, get_run_graph
    from backend.models.simulation import SimulationCreateRequest

    degraded_metadata = {
        "project_id": "",
        "graph_id": "",
        "graph_source": "local_only",
        "graph_entity_count": 0,
        "graph_relation_count": 0,
        "graph_entity_types": [],
        "graph_synced_at": None,
    }

    with patch("backend.api.routes.simulation._provision_run_graph", return_value=degraded_metadata):
        run = await create_run(
            SimulationCreateRequest(
                name="graph-route-degrade",
                seed_content="南海 局势与多方博弈",
                simulation_requirement="验证没有 graph_id 时仍能返回本地图谱。",
                max_rounds=2,
            )
        )

    graph = await get_run_graph(run["run_id"])

    assert graph["project_id"] == ""
    assert graph["graph_id"] == ""
    assert graph["graph_source"] == "local_only"
    assert graph["graph_entity_count"] == len(graph["nodes"])
    assert graph["graph_relation_count"] == len(graph["edges"])
    assert set(graph["graph_entity_types"]) >= {node["type"] for node in graph["nodes"]}
    assert graph["graph_synced_at"] is None
    assert isinstance(graph["nodes"], list)
    assert isinstance(graph["edges"], list)
    assert len(graph["nodes"]) >= 3



def test_delete_run_stops_runner() -> None:
    asyncio.run(_assert_delete_run_stops_runner())



def test_run_graph_returns_graph_metadata() -> None:
    asyncio.run(_assert_run_graph_returns_graph_metadata())



def test_run_graph_gracefully_degrades_to_local_graph() -> None:
    asyncio.run(_assert_run_graph_gracefully_degrades_to_local_graph())


async def _assert_graph_builder_info_gracefully_degrades() -> None:
    from backend.graph.graph_builder import GraphBuilder

    class FakeResponse:
        def __init__(self, is_success: bool, payload):
            self.is_success = is_success
            self._payload = payload

        def json(self):
            return self._payload

    builder = GraphBuilder(base_url="http://graphiti.local")

    with patch("backend.graph.graph_builder.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.get.return_value = FakeResponse(
            True,
            [
                {"labels": ["Entity", "Country", "Region"]},
                {"labels": ["Node", "Narrative", "Country"]},
                {"labels": []},
            ],
        )

        info = builder.get_graph_info("graph-1")

    assert info.graph_id == "graph-1"
    assert info.node_count == 3
    assert info.edge_count == 0
    assert info.entity_types == ["Country", "Narrative", "Region"]
    client.get.assert_called_once_with(
        "http://graphiti.local/episodes/graph-1",
        headers=builder._headers(),
        params={"last_n": 100},
    )

    with patch("backend.graph.graph_builder.httpx.Client") as client_cls:
        client = client_cls.return_value.__enter__.return_value
        client.get.side_effect = RuntimeError("graphiti unavailable")

        degraded = builder.get_graph_info("graph-2")

    assert degraded.graph_id == "graph-2"
    assert degraded.node_count == 0
    assert degraded.edge_count == 0
    assert degraded.entity_types == []



def test_graph_builder_info_gracefully_degrades() -> None:
    asyncio.run(_assert_graph_builder_info_gracefully_degrades())



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
