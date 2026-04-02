from __future__ import annotations
"""OrcaFish Cooldown Manager — prevents duplicate triggers per region"""
import asyncio
from datetime import datetime, timedelta
from backend.config import settings


class CooldownManager:
    """
    Each country_iso has a cooldown period to prevent duplicate pipelines.
    Based on OrcaFish Bridge design.
    """

    def __init__(self, cooldown_seconds: int = None):
        self.cooldown_seconds = cooldown_seconds or settings.cooldown_seconds
        self._last_trigger: dict[str, datetime] = {}
        self._lock = asyncio.Lock()

    async def can_trigger(self, country_iso: str) -> bool:
        """Return True if country is not in cooldown period"""
        async with self._lock:
            last = self._last_trigger.get(country_iso)
            if last is None:
                return True
            elapsed = (datetime.utcnow() - last).total_seconds()
            return elapsed >= self.cooldown_seconds

    async def record_trigger(self, country_iso: str):
        """Record a trigger for this country (starts cooldown)"""
        async with self._lock:
            self._last_trigger[country_iso] = datetime.utcnow()

    async def time_remaining(self, country_iso: str) -> float:
        """Return seconds until cooldown expires"""
        async with self._lock:
            last = self._last_trigger.get(country_iso)
            if last is None:
                return 0.0
            elapsed = (datetime.utcnow() - last).total_seconds()
            return max(0.0, self.cooldown_seconds - elapsed)
