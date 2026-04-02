from __future__ import annotations
"""OrcaFish CII (Country Intelligence Index) Engine — ported from WorldMonitor"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
import math


# ── CURATED COUNTRIES ────────────────────────────────────────────────────────
# From worldmonitor/src/config/countries.ts
CURATED_COUNTRIES: dict[str, dict] = {
    "UA": {"name": "乌克兰", "baseline_risk": 72.0, "event_multiplier": 1.2},
    "RU": {"name": "俄罗斯", "baseline_risk": 58.0, "event_multiplier": 1.1},
    "CN": {"name": "中国", "baseline_risk": 42.0, "event_multiplier": 1.0},
    "IR": {"name": "伊朗", "baseline_risk": 61.0, "event_multiplier": 1.15},
    "IL": {"name": "以色列", "baseline_risk": 55.0, "event_multiplier": 1.1},
    "TW": {"name": "台湾", "baseline_risk": 45.0, "event_multiplier": 1.05},
    "KP": {"name": "朝鲜", "baseline_risk": 65.0, "event_multiplier": 1.1},
    "SA": {"name": "沙特", "baseline_risk": 38.0, "event_multiplier": 1.0},
    "TR": {"name": "土耳其", "baseline_risk": 44.0, "event_multiplier": 1.0},
    "PK": {"name": "巴基斯坦", "baseline_risk": 52.0, "event_multiplier": 1.1},
    "IN": {"name": "印度", "baseline_risk": 40.0, "event_multiplier": 1.0},
    "US": {"name": "美国", "baseline_risk": 22.0, "event_multiplier": 0.9},
    "GB": {"name": "英国", "baseline_risk": 20.0, "event_multiplier": 0.9},
    "FR": {"name": "法国", "baseline_risk": 24.0, "event_multiplier": 0.9},
    "DE": {"name": "德国", "baseline_risk": 21.0, "event_multiplier": 0.9},
    "MM": {"name": "缅甸", "baseline_risk": 58.0, "event_multiplier": 1.1},
    "IQ": {"name": "伊拉克", "baseline_risk": 54.0, "event_multiplier": 1.1},
    "AF": {"name": "阿富汗", "baseline_risk": 70.0, "event_multiplier": 1.2},
    "VE": {"name": "委内瑞拉", "baseline_risk": 60.0, "event_multiplier": 1.1},
    "BY": {"name": "白俄罗斯", "baseline_risk": 50.0, "event_multiplier": 1.0},
}


@dataclass
class ComponentScoresData:
    unrest: float = 0.0
    conflict: float = 0.0
    security: float = 0.0
    information: float = 0.0


@dataclass
class CountryData:
    """Accumulated raw data per country for CII computation"""
    code: str
    name: str
    protests: list[dict] = field(default_factory=list)
    conflicts: list[dict] = field(default_factory=list)
    military_flights: int = 0
    military_vessels: int = 0
    internet_outages: int = 0
    news_velocity: float = 0.0
    news_count: int = 0
    displacement_outflow: int = 0
    displacement_inflow: int = 0
    displacement_score: float = 0.0
    climate_stress: float = 0.0
    advisory_level: str = ""  # do_not_travel/reconsider/normal
    hotspots_nearby: int = 0
    ucdp_level: str = ""  # war/minor/one_sided/no
    ais_disruptions: int = 0
    satellite_fires: int = 0
    cyber_threats: int = 0
    gps_jamming: int = 0
    radiation: int = 0
    baseline_risk: float = 40.0
    event_multiplier: float = 1.0
    # 24h trend
    prev_cii: float = 0.0


class CIIEngine:
    """
    Country Intelligence Index Engine.
    Ported from worldmonitor/src/services/country-instability.ts

    Dimensions:
      - unrest (25%): protests + fatalities + internet outages
      - conflict (30%): ACLED battles/explosions/civilian violence + UCDP + strikes
      - security (20%): military flights/vessels + aviation disruptions + GPS jamming
      - information (25%): news velocity + alert count

    Formula:
      eventScore = unrest*0.25 + conflict*0.30 + security*0.20 + information*0.25
      blendedScore = baselineRisk*0.4 + eventScore*0.6 + all boosts
    """

    def __init__(self):
        self._data: dict[str, CountryData] = {}
        self._prev_scores: dict[str, float] = {}
        self._initialize_countries()

    def _initialize_countries(self):
        for iso, cfg in CURATED_COUNTRIES.items():
            self._data[iso] = CountryData(
                code=iso,
                name=cfg["name"],
                baseline_risk=cfg["baseline_risk"],
                event_multiplier=cfg["event_multiplier"],
            )

    # ── Ingest Methods (port from TS ingest*ForCII functions) ─────────────

    def ingest_protests(self, events: list[dict]):
        """Ingest ACLED/GDELT protest events"""
        for e in events:
            iso = e.get("country_iso", "")
            if iso in self._data:
                self._data[iso].protests.append(e)

    def ingest_conflicts(self, events: list[dict]):
        """Ingest ACLED conflict events (battles/explosions/civilian)"""
        for e in events:
            iso = e.get("country_iso", "")
            if iso in self._data:
                self._data[iso].conflicts.append(e)

    def ingest_ucdp(self, events: list[dict]):
        """Ingest UCDP conflict level"""
        for e in events:
            iso = e.get("country_iso", "")
            if iso in self._data and "ucdp_level" in e:
                self._data[iso].ucdp_level = e["ucdp_level"]

    def ingest_military(self, flights: int, vessels: int, iso: str):
        """Ingest military flight and vessel counts"""
        if iso in self._data:
            self._data[iso].military_flights += flights
            self._data[iso].military_vessels += vessels

    def ingest_outages(self, outages: list[dict]):
        """Ingest internet outage events"""
        for o in outages:
            iso = o.get("country_iso", "")
            if iso in self._data:
                severity = o.get("severity", "low")
                self._data[iso].internet_outages += {"high": 3, "medium": 2, "low": 1}.get(severity, 0)

    def ingest_news(self, clusters: list[dict]):
        """Ingest news velocity and count from clusters"""
        for c in clusters:
            iso = c.get("country_iso", "")
            if iso in self._data:
                self._data[iso].news_count += c.get("source_count", 0)
                self._data[iso].news_velocity += c.get("velocity", 0.0)

    def ingest_displacement(self, data: list[dict]):
        """Ingest UNHCR displacement data"""
        for d in data:
            iso = d.get("country_iso", "")
            if iso in self._data:
                self._data[iso].displacement_outflow = d.get("outflow", 0)
                self._data[iso].displacement_inflow = d.get("inflow", 0)
                outflow = d.get("outflow", 0)
                if outflow > 1_000_000:
                    self._data[iso].displacement_score = 3.0
                elif outflow > 100_000:
                    self._data[iso].displacement_score = 2.0
                elif outflow > 10_000:
                    self._data[iso].displacement_score = 1.0

    def ingest_advisories(self, advisories: list[dict]):
        """Ingest travel advisories (US/AU/UK/NZ)"""
        for a in advisories:
            iso = a.get("country_iso", "")
            if iso in self._data:
                level = a.get("level", "normal")
                if level == "do_not_travel":
                    self._data[iso].advisory_level = "do_not_travel"
                elif level == "reconsider":
                    self._data[iso].advisory_level = "reconsider"

    def ingest_ais_disruptions(self, disruptions: list[dict]):
        for d in disruptions:
            iso = d.get("country_iso", "")
            if iso in self._data:
                self._data[iso].ais_disruptions += 1

    def ingest_satellite_fires(self, fires: list[dict]):
        for f in fires:
            iso = f.get("country_iso", "")
            if iso in self._data:
                self._data[iso].satellite_fires += 1

    def ingest_cyber_threats(self, threats: list[dict]):
        for t in threats:
            iso = t.get("country_iso", "")
            if iso in self._data:
                self._data[iso].cyber_threats += 1

    def ingest_gps_jamming(self, jamming: list[dict]):
        for j in jamming:
            iso = j.get("country_iso", "")
            if iso in self._data:
                self._data[iso].gps_jamming += 1

    def ingest_hotspot_proximity(self, iso: str, nearby_count: int):
        if iso in self._data:
            self._data[iso].hotspots_nearby = nearby_count

    # ── CII Calculation ────────────────────────────────────────────────────

    def _compute_unrest(self, d: CountryData) -> float:
        """Unrest (25%): protests + fatalities + internet outages"""
        protest_count = len(d.protests)
        protest_fatalities = sum(e.get("fatalities", 0) for e in d.protests)
        protest_severity = min(1.0, (protest_count / 20.0) + (protest_fatalities / 100.0))
        outage_boost = d.internet_outages * 1.5
        return min(100.0, protest_severity * 40 + outage_boost)

    def _compute_conflict(self, d: CountryData) -> float:
        """Conflict (30%): ACLED events + UCDP level + strikes"""
        conflict_count = len(d.conflicts)
        event_score = min(100.0, conflict_count * 3.0)

        # UCDP floor enforcement
        ucdp_floor = 0.0
        if d.ucdp_level == "war":
            ucdp_floor = 70.0
        elif d.ucdp_level == "minor":
            ucdp_floor = 50.0
        elif d.ucdp_level == "one_sided":
            ucdp_floor = 30.0

        # News floor boost
        news_floor = 0.0
        if d.news_count > 50:
            news_floor = 15.0
        elif d.news_count > 20:
            news_floor = 8.0

        return max(event_score, ucdp_floor) + news_floor

    def _compute_security(self, d: CountryData) -> float:
        """Security (20%): military activity + aviation + GPS"""
        flight_score = min(100.0, d.military_flights / 10.0 * 20.0)
        vessel_score = min(50.0, d.military_vessels / 5.0 * 15.0)
        gps_score = min(30.0, d.gps_jamming * 5.0)
        return flight_score + vessel_score + gps_score

    def _compute_information(self, d: CountryData) -> float:
        """Information (25%): news velocity and volume"""
        velocity_score = min(100.0, d.news_velocity * 20.0)
        volume_score = min(50.0, d.news_count / 2.0)
        return velocity_score + volume_score

    def _compute_boosts(self, d: CountryData) -> float:
        """Additional boost factors"""
        boost = 0.0

        # Displacement outflow (>100K refugees)
        boost += d.displacement_score * 5.0

        # Climate stress
        boost += d.climate_stress * 3.0

        # Travel advisory floor
        if d.advisory_level == "do_not_travel":
            boost += 15.0
        elif d.advisory_level == "reconsider":
            boost += 8.0

        # Hotspot proximity
        boost += d.hotspots_nearby * 3.0

        # AIS disruptions
        boost += min(10.0, d.ais_disruptions * 2.0)

        # Satellite fires
        boost += min(8.0, d.satellite_fires * 1.5)

        # Cyber threats
        boost += min(10.0, d.cyber_threats * 2.0)

        return boost

    def calculate(self) -> dict[str, dict]:
        """
        Calculate CII scores for all countries.
        Returns dict: {iso -> {"score": float, "level": str, "components": dict, "trend": str}}
        """
        results = {}

        for iso, d in self._data.items():
            # Component scores
            unrest = self._compute_unrest(d)
            conflict = self._compute_conflict(d)
            security = self._compute_security(d)
            information = self._compute_information(d)

            # Weighted event score
            event_score = (
                unrest * 0.25 +
                conflict * 0.30 +
                security * 0.20 +
                information * 0.25
            )

            # UCDP floor enforcement (before blending)
            ucdp_floor = 0.0
            if d.ucdp_level == "war":
                ucdp_floor = 70.0
            elif d.ucdp_level == "minor":
                ucdp_floor = 50.0

            event_score = max(event_score, ucdp_floor)

            # Blended score
            blended = d.baseline_risk * 0.4 + event_score * 0.6 * d.event_multiplier

            # Add boosts
            blended += self._compute_boosts(d)

            # Clamp to 0-100
            score = max(0.0, min(100.0, blended))

            # Level
            if score >= 70:
                level = "critical"
            elif score >= 55:
                level = "high"
            elif score >= 40:
                level = "elevated"
            elif score >= 25:
                level = "normal"
            else:
                level = "low"

            # 24h trend
            prev = self._prev_scores.get(iso, score)
            if score > prev + 2:
                trend = "rising"
            elif score < prev - 2:
                trend = "falling"
            else:
                trend = "stable"
            change_24h = score - prev

            results[iso] = {
                "code": iso,
                "name": d.name,
                "score": round(score, 1),
                "level": level,
                "trend": trend,
                "change_24h": round(change_24h, 1),
                "components": {
                    "unrest": round(unrest, 1),
                    "conflict": round(conflict, 1),
                    "security": round(security, 1),
                    "information": round(information, 1),
                },
            }

            # Update for next iteration
            self._prev_scores[iso] = score

        return results

    def get_country(self, iso: str) -> Optional[CountryData]:
        return self._data.get(iso)

    def reset(self):
        """Clear all ingested data (but keep country configs)"""
        for iso in self._data:
            self._data[iso] = CountryData(
                code=iso,
                name=self._data[iso].name,
                baseline_risk=self._data[iso].baseline_risk,
                event_multiplier=self._data[iso].event_multiplier,
            )
