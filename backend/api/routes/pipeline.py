"""OrcaFish Pipeline API Routes"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.models.pipeline import TriggerEvent
from backend.models.simulation import VariableInjection

router = APIRouter(prefix="/pipeline", tags=["Pipeline"])

# Singleton orchestrator — set during app startup in main.py
_orchestrator = None


class InjectRequest(BaseModel):
    pipeline_id: str
    variable: str
    value: str
    description: str = ""


@router.get("/")
async def list_pipelines() -> dict:
    """List all pipelines"""
    if _orchestrator is None:
        return {"pipelines": []}
    pipelines = _orchestrator.list_pipelines()
    return {"pipelines": [p.model_dump() for p in pipelines]}


@router.get("/{pipeline_id}")
async def get_pipeline(pipeline_id: str) -> dict:
    """Get pipeline status"""
    if _orchestrator is None:
        raise HTTPException(status_code=503, detail="Orchestrator not initialized")
    p = _orchestrator.get_pipeline(pipeline_id)
    if not p:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return p.model_dump()


@router.post("/{pipeline_id}/inject")
async def inject_variable(pipeline_id: str, req: InjectRequest) -> dict:
    """Inject variable into pipeline simulation"""
    if _orchestrator is None:
        raise HTTPException(status_code=503, detail="Orchestrator not initialized")
    return await _orchestrator.inject_variable(
        pipeline_id, req.variable, req.value, req.description
    )


def set_orchestrator(orch):
    global _orchestrator
    _orchestrator = orch


def get_orchestrator():
    return _orchestrator
