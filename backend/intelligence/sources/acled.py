"""ACLED API client"""
from typing import List, Dict, Optional
import httpx


class ACLEDClient:
    """ACLED (Armed Conflict Location & Event Data) API client"""

    def __init__(self, api_key: Optional[str] = None, email: Optional[str] = None):
        self.api_key = api_key
        self.email = email
        self.base_url = "https://api.acleddata.com/acled/read"

    async def fetch_events(self, country: Optional[str] = None, limit: int = 500) -> List[Dict]:
        """Fetch conflict/protest events from ACLED"""
        if not self.api_key or not self.email:
            return []

        params = {
            "key": self.api_key,
            "email": self.email,
            "limit": limit
        }

        if country:
            params["country"] = country

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(self.base_url, params=params, timeout=30)
                resp.raise_for_status()
                data = resp.json()
                return data.get("data", [])
            except Exception:
                return []
