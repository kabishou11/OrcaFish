"""OrcaFish Signal Scheduler — background polling of intelligence data"""
import asyncio
from loguru import logger
from backend.config import settings
from backend.models.pipeline import TriggerEvent, PipelineEvent


class SignalScheduler:
    """
    Background scheduler that polls WorldMonitor intelligence data
    and submits trigger events to the orchestrator.

    Runs as a background asyncio task.
    """

    def __init__(
        self,
        orchestrator,  # PipelineOrchestrator
        broadcaster=None,
        poll_interval: int = None,
    ):
        self.orchestrator = orchestrator
        self.broadcaster = broadcaster
        self.poll_interval = poll_interval or settings.worldmonitor_poll_interval
        self._running = False
        self._task: asyncio.Task | None = None

    async def start(self):
        """Start the background polling loop"""
        self._running = True
        self._task = asyncio.create_task(self._poll_loop())
        logger.info(f"SignalScheduler started (interval={self.poll_interval}s)")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
        logger.info("SignalScheduler stopped")

    async def _poll_loop(self):
        """Main polling loop"""
        import os
        while self._running:
            try:
                await self._poll_once()
            except Exception as e:
                logger.error(f"Scheduler poll error: {e}")
            await asyncio.sleep(self.poll_interval)

    async def _poll_once(self):
        """
        Poll intelligence data and check trigger conditions.
        This is the core intelligence-to-pipeline bridge.
        """
        # Import here to avoid circular dependency
        from backend.intelligence import CIIEngine, SignalAggregator

        cii = CIIEngine()
        agg = SignalAggregator()

        # ── Simulate intelligence data ingestion ─────────────────────────────
        # In production, this would call actual data sources:
        # - ACLED API, UCDP API, GDELT, Cloudflare outages, etc.
        # For now, use the local intelligence engine

        # Calculate CII scores
        scores = cii.calculate()

        # Check trigger conditions
        for iso, result in scores.items():
            cii_score = result["score"]
            triggered_by = []
            signal_types = []

            # Condition 1: CII threshold
            if cii_score >= settings.cii_threshold:
                triggered_by.append("cii")

            # Condition 2: Signal convergence (simplified)
            clusters = agg.get_country_clusters()
            country_cluster = next((c for c in clusters if c.country_iso == iso), None)
            if country_cluster and len(country_cluster.signal_types) >= settings.convergence_min_signals:
                triggered_by.append("convergence")
                signal_types = country_cluster.signal_types

            if triggered_by:
                trigger = TriggerEvent(
                    country_iso=iso,
                    country_name=result["name"],
                    cii_score=cii_score,
                    triggered_by=triggered_by,
                    signal_types=signal_types,
                )
                logger.info(
                    f"Trigger detected: {iso} ({result['name']}) "
                    f"CII={cii_score} triggered_by={triggered_by}"
                )
                await self.orchestrator.submit(trigger)

                if self.broadcaster:
                    await self.broadcaster.broadcast(PipelineEvent(
                        event_type="signal.detected",
                        pipeline_id="",
                        data={"trigger": trigger.model_dump()},
                    ))
