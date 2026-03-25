"""
Report API endpoints for OrcaFish backend.
"""

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional, Dict, Any
import uuid
from datetime import datetime

router = APIRouter(prefix="/api/report", tags=["report"])

# In-memory storage for report status (replace with database in production)
report_status_store: Dict[str, Dict[str, Any]] = {}


class ReportGenerateRequest(BaseModel):
    """Request model for report generation"""
    topic: str
    data: Optional[Dict[str, Any]] = None
    template: Optional[str] = None


class ReportStatusResponse(BaseModel):
    """Response model for report status"""
    id: str
    status: str  # pending, processing, completed, failed
    progress: Optional[float] = None
    message: Optional[str] = None
    created_at: str
    updated_at: str


class ReportResponse(BaseModel):
    """Response model for generated report"""
    id: str
    html: str
    metadata: Optional[Dict[str, Any]] = None


@router.post("/generate")
async def generate_report(
    request: ReportGenerateRequest,
    background_tasks: BackgroundTasks
) -> Dict[str, str]:
    """
    Generate a new report.

    Returns report ID for status tracking.
    """
    report_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    report_status_store[report_id] = {
        "id": report_id,
        "status": "pending",
        "progress": 0.0,
        "message": "Report generation queued",
        "created_at": now,
        "updated_at": now,
        "topic": request.topic,
        "html": None,
        "metadata": None
    }

    # Add background task for actual report generation
    background_tasks.add_task(_generate_report_task, report_id, request)

    return {"id": report_id, "message": "Report generation started"}


@router.get("/{report_id}/status")
async def get_report_status(report_id: str) -> ReportStatusResponse:
    """Get report generation status"""
    if report_id not in report_status_store:
        raise HTTPException(status_code=404, detail="Report not found")

    status = report_status_store[report_id]
    return ReportStatusResponse(
        id=status["id"],
        status=status["status"],
        progress=status.get("progress"),
        message=status.get("message"),
        created_at=status["created_at"],
        updated_at=status["updated_at"]
    )


@router.get("/{report_id}")
async def get_report(report_id: str) -> ReportResponse:
    """Get generated report HTML"""
    if report_id not in report_status_store:
        raise HTTPException(status_code=404, detail="Report not found")

    status = report_status_store[report_id]

    if status["status"] != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Report not ready. Current status: {status['status']}"
        )

    return ReportResponse(
        id=status["id"],
        html=status["html"],
        metadata=status.get("metadata")
    )


async def _generate_report_task(report_id: str, request: ReportGenerateRequest):
    """Background task for report generation"""
    try:
        # Update status to processing
        report_status_store[report_id]["status"] = "processing"
        report_status_store[report_id]["progress"] = 0.1
        report_status_store[report_id]["message"] = "Initializing report generation"
        report_status_store[report_id]["updated_at"] = datetime.utcnow().isoformat()

        # TODO: Integrate with ReportAgent
        # from .agent import ReportAgent
        # agent = ReportAgent()
        # result = await agent.generate(request.topic, request.data)

        # Placeholder HTML
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Report: {request.topic}</title>
            <link rel="stylesheet" href="/static/report.css">
        </head>
        <body class="report-body">
            <h1>{request.topic}</h1>
            <p>Report generation in progress...</p>
        </body>
        </html>
        """

        # Update status to completed
        report_status_store[report_id]["status"] = "completed"
        report_status_store[report_id]["progress"] = 1.0
        report_status_store[report_id]["message"] = "Report generated successfully"
        report_status_store[report_id]["html"] = html_content
        report_status_store[report_id]["updated_at"] = datetime.utcnow().isoformat()

    except Exception as e:
        report_status_store[report_id]["status"] = "failed"
        report_status_store[report_id]["message"] = f"Error: {str(e)}"
        report_status_store[report_id]["updated_at"] = datetime.utcnow().isoformat()
