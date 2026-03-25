"""OrcaFish — Unified Intelligence System  (FastAPI Application Entry Point)"""
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger
import asyncio

from backend.config import settings
from backend.api.routes import intelligence, analysis, simulation, pipeline, graph
from backend.api.routes.pipeline import set_orchestrator
from backend.api.ws import WebSocketBroadcaster
from backend.pipeline import CooldownManager, PipelineOrchestrator, SignalScheduler


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown hooks."""
    logger.info("OrcaFish starting up...")
    logger.info(f"Debug mode: {settings.debug}")
    logger.info(f"Query LLM: {settings.query_llm.provider}/{settings.query_llm.model}")
    logger.info(f"Media LLM: {settings.media_llm.provider}/{settings.media_llm.model}")
    logger.info(f"Insight LLM: {settings.insight_llm.provider}/{settings.insight_llm.model}")
    logger.info(f"Report LLM: {settings.report_llm.provider}/{settings.report_llm.model}")

    # ── Pipeline Infrastructure ───────────────────────────────────────────
    broadcaster = WebSocketBroadcaster()
    app.state.broadcaster = broadcaster

    cooldown = CooldownManager(cooldown_seconds=settings.cooldown_seconds)
    orchestrator = PipelineOrchestrator(cooldown_manager=cooldown, broadcaster=broadcaster)
    app.state.orchestrator = orchestrator
    set_orchestrator(orchestrator)

    # Start background signal scheduler
    scheduler = SignalScheduler(
        orchestrator=orchestrator,
        broadcaster=broadcaster,
        poll_interval=settings.worldmonitor_poll_interval,
    )
    app.state.scheduler = scheduler
    asyncio.create_task(scheduler.start())
    logger.info("Signal scheduler started.")

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────
    logger.info("OrcaFish shutting down...")
    await scheduler.stop()
    logger.info("Shutdown complete.")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="OrcaFish",
    description="融合地缘情报监测、舆情分析、群体智能仿真的统一情报系统",
    version="0.1.0",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(intelligence.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")
app.include_router(simulation.router, prefix="/api")
app.include_router(pipeline.router, prefix="/api")
app.include_router(graph.router, prefix="/api")


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Kubernetes / load-balancer health check endpoint."""
    broadcaster: WebSocketBroadcaster | None = getattr(app.state, "broadcaster", None)
    return {
        "status": "healthy",
        "service": "orcafish",
        "version": "0.1.0",
        "debug": settings.debug,
        "ws_connections": broadcaster.total_connections() if broadcaster else 0,
    }


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws/global")
async def ws_global(websocket: WebSocket):
    """Global event stream — all pipeline events broadcast here."""
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
    """Pipeline-specific event stream."""
    broadcaster: WebSocketBroadcaster = app.state.broadcaster
    await broadcaster.connect(websocket, pipeline_id=pipeline_id)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await broadcaster.disconnect(websocket, pipeline_id=pipeline_id)


# ── Entry Point (uvicorn) ─────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.debug,
        log_level="debug" if settings.debug else "info",
    )
