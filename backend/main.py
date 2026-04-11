"""OrcaFish — Unified Intelligence System  (FastAPI Application Entry Point)"""
from __future__ import annotations

import asyncio
import os
import subprocess
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
import httpx

from backend.config import settings
from backend.api.routes import intelligence, analysis, simulation, pipeline, graph
from backend.report.api import router as report_router
from backend.api.routes.pipeline import set_orchestrator
from backend.api.ws import WebSocketBroadcaster
from backend.pipeline import CooldownManager, PipelineOrchestrator, SignalScheduler
from backend.crawl4ai_client import ensure_crawl4ai_installed, crawl4ai_health

# ── Zep CE 服务管理 ───────────────────────────────────────────────────────────

ZEP_DOCKER_COMPOSE_PATH = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "zep", "legacy", "docker-compose.ce.yaml")
)


def _is_docker_available() -> bool:
    try:
        result = subprocess.run(["docker", "info"], capture_output=True, timeout=5)
        return result.returncode == 0
    except Exception:
        return False


def _is_zep_ce_running() -> bool:
    base_url = settings.zep_base_url.rstrip("/")
    if not base_url:
        return False
    for path in ("/healthz", "/health"):
        try:
            resp = httpx.get(f"{base_url}{path}", timeout=3)
            if resp.is_success:
                return True
        except Exception:
            continue
    return False


async def _start_zep_ce() -> bool:
    compose_path = ZEP_DOCKER_COMPOSE_PATH
    if not os.path.exists(compose_path):
        logger.warning(f"Zep CE docker-compose.yaml 未找到: {compose_path}")
        return False
    if not _is_docker_available():
        logger.warning("Docker 未运行，请先启动 Docker Desktop")
        return False

    try:
        logger.info("正在启动 Zep CE 服务（docker compose up -d）...")
        subprocess.run(
            ["docker", "compose", "-f", compose_path, "up", "-d"],
            check=True,
            timeout=120,
        )
        for i in range(30):
            await asyncio.sleep(2)
            if _is_zep_ce_running():
                logger.info("Zep CE 服务已就绪")
                return True
            logger.debug(f"等待 Zep CE 启动... ({i+1}/30)")
        logger.warning("Zep CE 启动超时，继续运行（知识图谱功能将降级）")
        return False
    except Exception as e:
        logger.warning(f"启动 Zep CE 失败: {e}，继续运行")
        return False


# ── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("OrcaFish 启动中...")
    logger.info(f"调试模式: {settings.debug}")
    logger.info(f"Query LLM: {settings.query_llm.provider}/{settings.query_llm.model}")
    logger.info(f"Media LLM: {settings.media_llm.provider}/{settings.media_llm.model}")
    logger.info(f"Insight LLM: {settings.insight_llm.provider}/{settings.insight_llm.model}")
    logger.info(f"Report LLM: {settings.report_llm.provider}/{settings.report_llm.model}")

    # ── 启动/检查 crawl4ai（源码安装到项目 .venv）─────────────────────────
    crawl_ok, crawl_err = ensure_crawl4ai_installed()
    if crawl_ok:
        logger.info("crawl4ai 已安装，可直接在后端进程中调用")
    else:
        logger.warning(f"crawl4ai 自动安装失败，将继续启动: {crawl_err}")

    # ── 启动 Zep CE（本地 Docker）──────────────────────────────────────────
    if settings.zep_base_url and settings.zep_base_url != "http://localhost:8000":
        logger.info(f"Zep 地址已指定: {settings.zep_base_url}，跳过自动启动")
    else:
        if _is_zep_ce_running():
            logger.info("Zep CE 服务已在运行")
        else:
            await _start_zep_ce()

    # ── Pipeline Infrastructure ─────────────────────────────────────────
    broadcaster = WebSocketBroadcaster()
    app.state.broadcaster = broadcaster

    cooldown = CooldownManager(cooldown_seconds=settings.cooldown_seconds)
    orchestrator = PipelineOrchestrator(cooldown_manager=cooldown, broadcaster=broadcaster)
    app.state.orchestrator = orchestrator
    set_orchestrator(orchestrator)

    scheduler = SignalScheduler(
        orchestrator=orchestrator,
        broadcaster=broadcaster,
        poll_interval=settings.worldmonitor_poll_interval,
    )
    app.state.scheduler = scheduler
    asyncio.create_task(scheduler.start())
    logger.info("信号调度器已启动")

    yield

    logger.info("OrcaFish 关闭中...")
    await scheduler.stop()
    logger.info("关闭完成")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="OrcaFish 预见中枢",
    description="融合全球观测、议题研判、未来推演的统一情报系统",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(intelligence.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")
app.include_router(simulation.router, prefix="/api")
app.include_router(pipeline.router, prefix="/api")
app.include_router(graph.router, prefix="/api")
app.include_router(report_router)


@app.get("/health")
async def health_check():
    zep_ok = _is_zep_ce_running()
    broadcaster: WebSocketBroadcaster | None = getattr(app.state, "broadcaster", None)
    return {
        "status": "healthy",
        "service": "orcafish",
        "version": "0.2.0",
        "zep_ce": "running" if zep_ok else "not_running",
        "crawl4ai": crawl4ai_health(),
        "ws_connections": broadcaster.total_connections() if broadcaster else 0,
    }


@app.websocket("/ws/global")
async def ws_global(websocket: WebSocket):
    broadcaster: WebSocketBroadcaster = app.state.broadcaster
    await broadcaster.connect(websocket, pipeline_id=None)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await broadcaster.disconnect(websocket, pipeline_id=None)


@app.websocket("/ws/pipeline/{pipeline_id}")
async def ws_pipeline(pipeline_id: str, websocket: WebSocket):
    broadcaster: WebSocketBroadcaster = app.state.broadcaster
    await broadcaster.connect(websocket, pipeline_id=pipeline_id)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await broadcaster.disconnect(websocket, pipeline_id=pipeline_id)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host=settings.app_host,
        port=settings.app_port,
        # 直接运行时优先保证稳定启动；需要热重载时使用 README 中的 uvicorn --reload 命令。
        reload=False,
        log_level="debug" if settings.debug else "info",
    )
