"""UCDP API client"""
from typing import List, Dict
import httpx


class UCDPClient:
    """UCDP (Uppsala Conflict Data Program) API client"""

    def __init__(self):
        self.base_url = "https://ucdpapi.pcr.uu.se/api/gedevents/23.1"

    async def fetch_events(self, year: int = 2024) -> List[Dict]:
        """Fetch conflict events from UCDP"""
        params = {"year": year}

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(self.base_url, params=params, timeout=30)
                resp.raise_for_status()
                data = resp.json()
                return data.get("Result", [])
            except Exception:
                return []
