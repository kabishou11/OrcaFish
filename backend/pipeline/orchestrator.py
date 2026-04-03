from __future__ import annotations
"""OrcaFish Pipeline Orchestrator — zero-human three-stage pipeline"""
import asyncio
import uuid
import os
import html2text
from datetime import datetime
from typing import Optional
from loguru import logger

from backend.config import settings
from backend.models.pipeline import PipelineState, TriggerEvent, PipelineEvent
from backend.models.analysis import AnalysisTask
from backend.pipeline.cooldown import CooldownManager
from backend.pipeline.scheduler import SignalScheduler

# Lazy imports to avoid circular deps
_cii_engine = None
_signal_aggregator = None


def get_cii_engine():
    global _cii_engine
    if _cii_engine is None:
        from backend.intelligence import CIIEngine
        _cii_engine = CIIEngine()
    return _cii_engine


def get_signal_aggregator():
    global _signal_aggregator
    if _signal_aggregator is None:
        from backend.intelligence import SignalAggregator
        _signal_aggregator = SignalAggregator()
    return _signal_aggregator


class PipelineOrchestrator:
    """
    Core orchestrator for the three-stage pipeline:
      Stage 1: Intelligence confirmation + BettaFish analysis
      Stage 2: MiroFish OASIS simulation
      Stage 3: Result aggregation

    Runs in background, emits events via broadcaster.
    """

    def __init__(
        self,
        cooldown_manager: CooldownManager,
        broadcaster: Optional[object] = None,
    ):
        self.cooldown = cooldown_manager
        self.broadcaster = broadcaster  # Will be set by main.py
        self._pipelines: dict[str, PipelineState] = {}
        self._analysis_tasks: dict[str, AnalysisTask] = {}

    async def submit(self, trigger: TriggerEvent) -> PipelineState:
        """Submit a new trigger event for pipeline processing"""
        # Check cooldown
        if not await self.cooldown.can_trigger(trigger.country_iso):
            logger.info(f"Skipping {trigger.country_iso} — in cooldown")
            return None

        await self.cooldown.record_trigger(trigger.country_iso)

        pipeline_id = f"pipe_{uuid.uuid4().hex[:12]}"
        state = PipelineState(
            pipeline_id=pipeline_id,
            country_iso=trigger.country_iso,
            country_name=trigger.country_name,
            lat=trigger.lat,
            lon=trigger.lon,
            cii_score=trigger.cii_score,
            triggered_by=trigger.triggered_by,
            signal_types=trigger.signal_types,
        )
        self._pipelines[pipeline_id] = state

        # Broadcast started event
        await self._broadcast(PipelineEvent(
            event_type="pipeline.started",
            pipeline_id=pipeline_id,
            data={"trigger": trigger.model_dump(), "stage": "detected"},
        ))

        # Run pipeline in background
        asyncio.create_task(self._run_pipeline(state, trigger))

        return state

    async def _run_pipeline(self, state: PipelineState, trigger: TriggerEvent):
        """Execute the full three-stage pipeline"""
        try:
            # ── Stage 1: BettaFish Analysis ────────────────────────────────
            state.stage = "analysis"
            state.stage_progress = 0
            await self._broadcast(PipelineEvent(
                event_type="pipeline.stage.started",
                pipeline_id=state.pipeline_id,
                data={"stage": "analysis", "message": "启动舆情分析..."},
            ))

            html_report = await self._run_analysis(trigger)
            state.analysis_html = html_report

            # Extract markdown from HTML for simulation seed
            h = html2text.html2text(html_report)
            state.analysis_markdown = h[:8000]  # Truncate for token limits

            state.stage_progress = 50
            await self._broadcast(PipelineEvent(
                event_type="pipeline.stage.completed",
                pipeline_id=state.pipeline_id,
                data={"stage": "analysis", "message": "舆情分析完成"},
            ))

            # ── Stage 2: MiroFish Simulation ────────────────────────────────
            state.stage = "simulation"
            state.stage_progress = 60
            await self._broadcast(PipelineEvent(
                event_type="pipeline.stage.started",
                pipeline_id=state.pipeline_id,
                data={"stage": "simulation", "message": "启动群体仿真..."},
            ))

            prediction = await self._run_simulation(trigger, state.analysis_markdown)
            state.prediction_markdown = prediction

            state.stage = "completed"
            state.stage_progress = 100
            state.completed_at = datetime.utcnow()
            await self._broadcast(PipelineEvent(
                event_type="pipeline.completed",
                pipeline_id=state.pipeline_id,
                data={
                    "stage": "completed",
                    "cii_score": state.cii_score,
                    "country": state.country_name,
                    "prediction_preview": prediction[:200] if prediction else "",
                },
            ))

        except Exception as e:
            logger.exception(f"Pipeline {state.pipeline_id} failed")
            state.stage = "failed"
            state.error_message = str(e)
            state.updated_at = datetime.utcnow()
            await self._broadcast(PipelineEvent(
                event_type="pipeline.failed",
                pipeline_id=state.pipeline_id,
                data={"error": str(e)},
            ))

    async def _run_analysis(self, trigger: TriggerEvent) -> str:
        """Run BettaFish analysis pipeline"""
        from backend.llm.client import LLMClient
        from backend.analysis import QueryAgent, ReportAgent

        # Build analysis topic
        topic = (
            f"{trigger.country_name}地区局势深度舆情分析 | "
            f"CII={trigger.cii_score} | "
            f"信号类型：{','.join(trigger.signal_types[:3])}"
        )

        # Use QueryAgent (simplified — no Tavily API needed for testing)
        llm = LLMClient(
            api_key=settings.query_llm.api_key,
            base_url=settings.query_llm.base_url,
            model=settings.query_llm.model,
            provider=settings.query_llm.provider,
            reasoning_split=settings.query_llm.reasoning_split,
        )
        query_agent = QueryAgent(llm)

        # Run research (with timeout)
        try:
            agent_state = await asyncio.wait_for(
                query_agent.research(topic),
                timeout=300.0,
            )
            query_report = agent_state.final_report
        except asyncio.TimeoutError:
            query_report = f"关于{trigger.country_name}局势的分析（超时，仅基于已有数据）"
        except Exception:
            query_report = f"{trigger.country_name}地区当前处于{'/'.join(trigger.signal_types)}多重信号叠加状态，建议关注。"

        # Generate final HTML report
        report_llm = LLMClient(
            api_key=settings.report_llm.api_key,
            base_url=settings.report_llm.base_url,
            model=settings.report_llm.model,
            provider=settings.report_llm.provider,
            reasoning_split=settings.report_llm.reasoning_split,
        )
        report_agent = ReportAgent(report_llm)

        task_id = f"task_{uuid.uuid4().hex[:8]}"
        html = await report_agent.generate(
            task_id=task_id,
            query=topic,
            query_report=query_report,
            media_report="（多媒体分析数据待接入）",
            insight_report="（社交媒体数据待接入）",
        )
        return html

    async def _run_simulation(self, trigger: TriggerEvent, seed_content: str) -> str:
        """Run MiroFish OASIS simulation via Zep CE knowledge graph + OASISRunner"""
        from backend.simulation import OASISRunner, SimulationReportAgent
        from backend.graph import GraphBuilder

        # Step 1: Build knowledge graph in Zep CE
        builder = GraphBuilder()  # 从 config 读取 zep_base_url
        graph_id = builder.create_graph(
            name=f"OrcaFish_{trigger.country_iso}_{datetime.utcnow().strftime('%Y%m%d')}"
        )
        # 将 seed_content 分块写入图谱
        chunks = [seed_content[i:i+500] for i in range(0, min(len(seed_content), 5000), 500)]
        builder.add_text_batch(graph_id, chunks)

        # Step 2: Create OASIS simulation
        runner = OASISRunner()
        sim_id, sim_dir = runner.create_simulation({
            "simulation_id": f"sim_{uuid.uuid4().hex[:12]}",
            "project_id": graph_id,
            "graph_id": graph_id,
        })

        state = self._pipelines.get(trigger.country_iso)
        # Update state
        for p in self._pipelines.values():
            if abs(p.cii_score - trigger.cii_score) < 0.1 and p.country_iso == trigger.country_iso:
                p.simulation_id = sim_id
                p.simulation_project_id = graph_id

        # Step 3: Start simulation
        status = await runner.start(
            simulation_id=sim_id,
            sim_dir=sim_dir,
            max_rounds=settings.simulation_rounds,
        )

        # Step 4: Poll until complete (simplified)
        for i in range(settings.simulation_rounds):
            await asyncio.sleep(10)
            current = await runner.get_status(sim_id)
            progress = 60 + int((i / settings.simulation_rounds) * 35)
            await self._broadcast(PipelineEvent(
                event_type="pipeline.stage.progress",
                pipeline_id=list(self._pipelines.values())[0].pipeline_id if self._pipelines else sim_id,
                data={
                    "stage": "simulation",
                    "progress": progress,
                    "round": i,
                    "total": settings.simulation_rounds,
                },
            ))
            if current.status == "completed":
                break

        # Step 5: Generate prediction report
        report_agent = SimulationReportAgent(llm)
        result = await report_agent.generate(
            simulation_id=sim_id,
            simulation_requirement=f"预测{trigger.country_name}地区局势演化",
            sim_dir=sim_dir,
        )
        return result.get("markdown_content", "")

    async def inject_variable(
        self,
        pipeline_id: str,
        variable: str,
        value: str,
        description: str,
    ) -> dict:
        """God-mode: inject a variable into a running simulation"""
        from backend.simulation import SimulationIPC

        state = self._pipelines.get(pipeline_id)
        if not state or not state.simulation_id:
            return {"error": "Simulation not found"}

        sim_dir = os.path.join(
            os.path.dirname(__file__), "..", "..", "data", "simulations", state.simulation_id
        )
        ipc = SimulationIPC(sim_dir)
        result = await ipc.interview_all_agents(
            simulation_id=state.simulation_id,
            prompt=f"【系统外部事件注入】{description}，变量: {variable}={value}",
        )
        return result

    async def _broadcast(self, event: PipelineEvent):
        """Broadcast event to all WebSocket subscribers"""
        if self.broadcaster:
            await self.broadcaster.broadcast(event)

    def get_pipeline(self, pipeline_id: str) -> Optional[PipelineState]:
        return self._pipelines.get(pipeline_id)

    def list_pipelines(self) -> list[PipelineState]:
        return list(self._pipelines.values())
