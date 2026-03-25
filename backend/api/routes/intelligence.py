"""OrcaFish Intelligence API Routes"""
import asyncio
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException
from backend.models.intelligence import CountryScore
from backend.intelligence import CIIEngine, SignalAggregator

router = APIRouter(prefix="/intelligence", tags=["Intelligence"])

_cii_engine = CIIEngine()
_signal_aggregator = SignalAggregator()

# World Monitor polling state
_wm_running = False
_wm_task: asyncio.Task | None = None
_wm_last_poll: datetime | None = None


@router.get("/world-monitor/status")
async def get_wm_status() -> dict:
    """Get World Monitor polling status"""
    return {
        "running": _wm_running,
        "last_poll": _wm_last_poll.isoformat() if _wm_last_poll else None,
        "poll_interval": 300,
        "cii_threshold": 65.0,
        "data_sources": ["ACLED", "UCDP", "FlightRadar24", "VesselFinder", "OONI"],
    }


@router.post("/world-monitor/start")
async def start_wm() -> dict:
    """Start the World Monitor background polling loop"""
    global _wm_running, _wm_task
    if _wm_running:
        return {"status": "already_running"}
    _wm_running = True

    async def poll_loop():
        global _wm_last_poll
        while _wm_running:
            try:
                _wm_last_poll = datetime.utcnow()
                # Trigger signal ingestion from configured sources
                _signal_aggregator.poll_external_sources()
            except Exception:
                pass
            await asyncio.sleep(300)

    _wm_task = asyncio.create_task(poll_loop())
    return {"status": "started"}


@router.post("/world-monitor/stop")
async def stop_wm() -> dict:
    """Stop the World Monitor background polling loop"""
    global _wm_running, _wm_task
    _wm_running = False
    if _wm_task:
        _wm_task.cancel()
        _wm_task = None
    return {"status": "stopped"}


@router.get("/cii")
async def get_cii_scores() -> dict:
    """Get CII scores for all monitored countries"""
    scores = _cii_engine.calculate()
    return {
        "scores": scores,
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/cii/{iso}")
async def get_country_cii(iso: str) -> dict:
    """Get CII details for a specific country"""
    scores = _cii_engine.calculate()
    if iso not in scores:
        raise HTTPException(status_code=404, detail="Country not found")
    return scores[iso]


@router.get("/signals")
async def get_signals(domain: Optional[str] = None) -> dict:
    """Get current signal aggregation, optionally filtered by domain"""
    clusters = _signal_aggregator.get_country_clusters(domain=domain)
    return {
        "clusters": [c.model_dump() for c in clusters],
        "regional": [r.model_dump() for r in _signal_aggregator.get_regional_convergence(domain=domain)],
        "domain": domain or "all",
    }


@router.get("/signals/convergence")
async def get_convergence() -> dict:
    """Get convergence zones (regional signal clustering)"""
    zones = _signal_aggregator.get_regional_convergence()
    return {
        "zones": [z.model_dump() for z in zones],
        "count": len(zones),
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.post("/ingest")
async def ingest_signals(data: dict) -> dict:
    """Ingest external signal data (webhook entry)"""
    signal_type = data.get("type", "")
    payload = data.get("data", [])

    if signal_type == "outages":
        _signal_aggregator.ingest_outages(payload)
    elif signal_type == "flights":
        _signal_aggregator.ingest_flights(payload)
    elif signal_type == "vessels":
        _signal_aggregator.ingest_vessels(payload)
    elif signal_type == "protests":
        _signal_aggregator.ingest_protests(payload)
    elif signal_type == "conflicts":
        _signal_aggregator.ingest_conflict_events(payload)

    return {"status": "ok", "ingested": len(payload)}
