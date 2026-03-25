"""CII Cache - migrated from WorldMonitor cached-risk-scores.ts"""
from typing import Optional, Dict
from datetime import datetime, timedelta
import json


class CIICache:
    """In-memory cache for CII scores"""

    def __init__(self, ttl_minutes: int = 30):
        self._cache: Optional[Dict] = None
        self._cached_at: Optional[datetime] = None
        self._ttl = timedelta(minutes=ttl_minutes)

    def get(self) -> Optional[Dict]:
        """Get cached scores if not stale"""
        if not self._cache or not self._cached_at:
            return None

        if datetime.utcnow() - self._cached_at > self._ttl:
            return None

        return self._cache

    def set(self, data: Dict):
        """Cache CII scores"""
        self._cache = data
        self._cached_at = datetime.utcnow()

    def clear(self):
        """Clear cache"""
        self._cache = None
        self._cached_at = None
