"""OrcaFish Signal Aggregator — ported from WorldMonitor signal-aggregator.ts"""
from datetime import datetime, timedelta
from typing import Optional
from dataclasses import dataclass, field
from loguru import logger
from backend.models.intelligence import GeoSignal, CountrySignalCluster, RegionalConvergence


# Known geographic hotspots
INTEL_HOTSPOTS = [
    {"name": "乌克兰东部", "lat": 48.8, "lon": 37.5, "radius_km": 150},
    {"name": "以色列-加沙", "lat": 31.5, "lon": 34.5, "radius_km": 100},
    {"name": "台湾海峡", "lat": 24.5, "lon": 119.5, "radius_km": 200},
    {"name": "朝鲜半岛", "lat": 38.0, "lon": 127.0, "radius_km": 150},
    {"name": "伊朗核设施", "lat": 32.3, "lon": 53.7, "radius_km": 100},
    {"name": "南海争议", "lat": 14.5, "lon": 115.0, "radius_km": 300},
]

REGIONAL_ZONES: dict[str, tuple[str, ...]] = {
    "middle_east": ("IR", "IL", "IQ", "SY", "SA", "YE", "JO", "LB"),
    "east_asia": ("CN", "TW", "KP", "KR", "JP"),
    "south_asia": ("PK", "IN", "AF", "MM"),
    "eastern_europe": ("UA", "RU", "BY", "MD"),
    "north_africa": ("LY", "EG", "TN", "DZ", "MA"),
    "sahel": ("ML", "NE", "TD", "SD"),
}


# Domain → signal type mapping for frontend domain filter
DOMAIN_SIGNAL_TYPES: dict[str, tuple[str, ...]] = {
    "military": ("conflict", "military_flight", "military_vessel", "satellite_fire", "protest"),
    "economic": ("economic_sanction", "trade_dispute", "currency_crisis", "resource_shortage"),
    "diplomatic": ("diplomatic_tension", "alliance_shift", "protest"),
    "humanitarian": ("humanitarian_crisis", "pandemic", "refugee_crisis", "natural_disaster"),
    "info": ("internet_outage", "disinformation", "ais_disruption"),
}


def _filter_by_domain(signals: list[GeoSignal], domain: str) -> list[GeoSignal]:
    """Filter signals by domain mapping"""
    types = DOMAIN_SIGNAL_TYPES.get(domain, ())
    if not types:
        return signals  # 'all' or unknown domain → return all
    return [s for s in signals if s.signal_type in types]


@dataclass
class SignalAggregator:
    """
    Aggregates 11 signal types into geographic clusters.
    From worldmonitor/src/services/signal-aggregator.ts
    """
    _signals: list[GeoSignal] = field(default_factory=list)
    _prune_hours: int = 24

    # ── Ingest Methods ─────────────────────────────────────────────────────

    def ingest_outages(self, data: list[dict]):
        for d in data:
            self._signals.append(GeoSignal(
                signal_type="internet_outage",
                country_iso=d.get("country_iso", ""),
                lat=d.get("lat", 0.0),
                lon=d.get("lon", 0.0),
                severity=d.get("severity", "low"),
                count=d.get("affected_users", 0),
                source=d.get("source", ""),
            ))

    def ingest_flights(self, data: list[dict]):
        by_country: dict[str, int] = {}
        for d in data:
            iso = d.get("country_iso", "")
            if iso:
                by_country[iso] = by_country.get(iso, 0) + 1
        for iso, count in by_country.items():
            sev = "high" if count >= 10 else "medium" if count >= 5 else "low"
            self._signals.append(GeoSignal(
                signal_type="military_flight",
                country_iso=iso,
                lat=0.0, lon=0.0,
                severity=sev,
                count=count,
                value=float(count),
            ))

    def ingest_vessels(self, data: list[dict]):
        by_country: dict[str, int] = {}
        for d in data:
            iso = d.get("country_iso", "")
            if iso:
                by_country[iso] = by_country.get(iso, 0) + 1
        for iso, count in by_country.items():
            sev = "high" if count >= 5 else "medium" if count >= 2 else "low"
            self._signals.append(GeoSignal(
                signal_type="military_vessel",
                country_iso=iso,
                lat=0.0, lon=0.0,
                severity=sev,
                count=count,
            ))

    def ingest_protests(self, data: list[dict]):
        by_country: dict[str, dict] = {}
        for d in data:
            iso = d.get("country_iso", "")
            if iso not in by_country:
                by_country[iso] = {"count": 0, "lat": 0.0, "lon": 0.0}
            by_country[iso]["count"] += 1
            if "lat" in d:
                by_country[iso]["lat"] = d["lat"]
            if "lon" in d:
                by_country[iso]["lon"] = d["lon"]
        for iso, info in by_country.items():
            sev = "high" if info["count"] >= 10 else "medium" if info["count"] >= 5 else "low"
            self._signals.append(GeoSignal(
                signal_type="protest",
                country_iso=iso,
                lat=info["lat"],
                lon=info["lon"],
                severity=sev,
                count=info["count"],
            ))

    def ingest_ais_disruptions(self, data: list[dict]):
        for d in data:
            self._signals.append(GeoSignal(
                signal_type="ais_disruption",
                country_iso=d.get("country_iso", ""),
                lat=d.get("lat", 0.0),
                lon=d.get("lon", 0.0),
                severity=d.get("severity", "low"),
            ))

    def ingest_satellite_fires(self, data: list[dict]):
        for d in data:
            self._signals.append(GeoSignal(
                signal_type="satellite_fire",
                country_iso=d.get("country_iso", ""),
                lat=d.get("lat", 0.0),
                lon=d.get("lon", 0.0),
                severity="high" if d.get("brightness", 0) > 360 else "medium",
                count=1,
            ))

    def ingest_conflict_events(self, data: list[dict]):
        for d in data:
            self._signals.append(GeoSignal(
                signal_type="conflict",
                country_iso=d.get("country_iso", ""),
                lat=d.get("lat", 0.0),
                lon=d.get("lon", 0.0),
                severity=d.get("severity", "medium"),
                count=d.get("count", 1),
            ))

    # ── Aggregation ────────────────────────────────────────────────────────

    def get_country_clusters(self, domain: Optional[str] = None) -> list[CountrySignalCluster]:
        """Aggregate signals by country with convergence scoring, optionally filtered by domain"""
        now = datetime.utcnow()
        # Filter by domain first if specified
        filtered = [s for s in self._signals if not s.timestamp or (now - s.timestamp) < timedelta(hours=self._prune_hours)]
        if domain and domain != 'all':
            filtered = _filter_by_domain(filtered, domain)

        by_country: dict[str, list[GeoSignal]] = {}
        for sig in filtered:
            if sig.country_iso:
                by_country.setdefault(sig.country_iso, []).append(sig)

        clusters = []
        for iso, signals in by_country.items():
            types = list(set(s.signal_type for s in signals))
            total_count = sum(s.count for s in signals)
            high_severity = sum(1 for s in signals if s.severity == "high")

            # Convergence score formula from TS source
            convergence_score = (
                len(types) * 20 +
                total_count * 5 +
                high_severity * 10
            )

            clusters.append(CountrySignalCluster(
                country_iso=iso,
                signals=signals,
                convergence_score=convergence_score,
                signal_types=types,
                total_count=total_count,
            ))

        clusters.sort(key=lambda c: c.convergence_score, reverse=True)
        return clusters

    def get_regional_convergence(self, domain: Optional[str] = None) -> list[RegionalConvergence]:
        """Detect cross-country convergence in defined regions, optionally filtered by domain"""
        country_clusters = {c.country_iso: c for c in self.get_country_clusters(domain=domain)}
        results = []

        for region, countries in REGIONAL_ZONES.items():
            region_signals: list[GeoSignal] = []
            for iso in countries:
                if iso in country_clusters:
                    region_signals.extend(country_clusters[iso].signals)

            if not region_signals:
                continue

            active_types = list(set(s.signal_type for s in region_signals))
            total_score = sum(
                c.convergence_score
                for c in country_clusters.values()
                if c.country_iso in countries
            )

            results.append(RegionalConvergence(
                region=region,
                countries=list(countries),
                convergence_score=total_score,
                active_signal_types=active_types,
            ))

        results.sort(key=lambda r: r.convergence_score, reverse=True)
        return results

    def get_signals(self) -> list[GeoSignal]:
        """Get all current signals (pruned by time)"""
        now = datetime.utcnow()
        return [
            s for s in self._signals
            if not s.timestamp or (now - s.timestamp) < timedelta(hours=self._prune_hours)
        ]

    def clear(self):
        self._signals = []

    def poll_external_sources(self):
        """
        Stub for external data source polling.
        In production: call GDELT/ACLED/UCDP/FlightRadar24/OONI APIs.
        For now: ingest synthetic data for demonstration.
        """
        from loguru import logger
        logger.debug("Polling external intelligence sources...")
        # TODO: Replace with real API calls:
        # - GDELT/ACLED for conflict & protest events
        # - UCDP for battle deaths & violence
        # - FlightRadar24 for military flight tracking
        # - VesselFinder for naval activity
        # - OONI for internet outages
