"""HAPI (Humanitarian API) client"""
from typing import List, Dict
import httpx


class HAPIClient:
    """HDX HAPI (Humanitarian Data Exchange) API client"""

    def __init__(self):
        self.base_url = "https://hapi.humdata.org/api/v1"

    async def fetch_conflict_data(self, country_code: Optional[str] = None) -> List[Dict]:
        """Fetch humanitarian conflict data"""
        url = f"{self.base_url}/coordination-context/conflict-event"
        params = {}

        if country_code:
            params["location_code"] = country_code

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(url, params=params, timeout=30)
                resp.raise_for_status()
                data = resp.json()
                return data.get("data", [])
            except Exception:
                return []
