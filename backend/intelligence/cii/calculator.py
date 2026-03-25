"""CII Calculator - migrated from WorldMonitor country-instability.ts"""
from typing import Dict, List, Optional
from datetime import datetime


class CIICalculator:
    """Calculates Country Intelligence Index scores"""

    def __init__(self):
        self.country_data: Dict[str, dict] = {}
        self.previous_scores: Dict[str, float] = {}

    def ingest_data(self, country_code: str, data: dict):
        """Ingest country data for CII calculation"""
        self.country_data[country_code] = data

    def calculate_score(self, country_code: str) -> Optional[dict]:
        """Calculate CII score for a country"""
        data = self.country_data.get(country_code)
        if not data:
            return None

        # Component scores (from TS logic)
        unrest = self._calc_unrest(data)
        conflict = self._calc_conflict(data)
        security = self._calc_security(data)
        information = self._calc_information(data)

        # Weighted blend
        event_score = unrest * 0.25 + conflict * 0.30 + security * 0.20 + information * 0.25
        baseline = data.get("baseline_risk", 40.0)
        score = baseline * 0.4 + event_score * 0.6
        score = max(0, min(100, score))

        level = self._get_level(score)
        trend = self._get_trend(country_code, score)

        return {
            "code": country_code,
            "score": round(score, 1),
            "level": level,
            "trend": trend,
            "change24h": round(score - self.previous_scores.get(country_code, score), 1),
            "components": {
                "unrest": round(unrest, 1),
                "conflict": round(conflict, 1),
                "security": round(security, 1),
                "information": round(information, 1)
            },
            "lastUpdated": datetime.utcnow().isoformat()
        }

    def _calc_unrest(self, data: dict) -> float:
        protests = data.get("protests", 0)
        outages = data.get("outages", 0)
        return min(100, protests * 8 + outages * 15)

    def _calc_conflict(self, data: dict) -> float:
        conflicts = data.get("conflicts", 0)
        strikes = data.get("strikes", 0)
        return min(100, conflicts * 3 + strikes * 5)

    def _calc_security(self, data: dict) -> float:
        flights = data.get("military_flights", 0)
        vessels = data.get("military_vessels", 0)
        return min(100, flights * 3 + vessels * 5)

    def _calc_information(self, data: dict) -> float:
        news = data.get("news_count", 0)
        velocity = data.get("news_velocity", 0)
        return min(100, news * 5 + velocity * 10)

    def _get_level(self, score: float) -> str:
        if score >= 70: return "critical"
        if score >= 55: return "high"
        if score >= 40: return "elevated"
        if score >= 25: return "normal"
        return "low"

    def _get_trend(self, code: str, current: float) -> str:
        prev = self.previous_scores.get(code, current)
        diff = current - prev
        self.previous_scores[code] = current
        if diff >= 5: return "rising"
        if diff <= -5: return "falling"
        return "stable"
