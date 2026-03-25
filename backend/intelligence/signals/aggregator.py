"""Signal Aggregator - migrated from WorldMonitor signal-aggregator.ts"""
from typing import List, Dict, Set
from datetime import datetime, timedelta
from .types import GeoSignal, SignalType


class SignalAggregator:
    """Aggregates geographic signals by country"""

    def __init__(self, window_hours: int = 24):
        self.signals: List[GeoSignal] = []
        self.window_hours = window_hours

    def ingest_signals(self, signals: List[GeoSignal]):
        """Ingest new signals"""
        self.signals.extend(signals)
        self._prune_old()

    def get_country_clusters(self) -> List[Dict]:
        """Get signals clustered by country"""
        by_country: Dict[str, List[GeoSignal]] = {}

        for sig in self.signals:
            if sig.country not in by_country:
                by_country[sig.country] = []
            by_country[sig.country].append(sig)

        clusters = []
        for country, sigs in by_country.items():
            signal_types = set(s.type for s in sigs)
            high_count = sum(1 for s in sigs if s.severity == "high")

            # Convergence score from TS
            convergence = len(signal_types) * 20 + len(sigs) * 5 + high_count * 10

            clusters.append({
                "country": country,
                "signals": len(sigs),
                "types": list(signal_types),
                "convergence_score": min(100, convergence),
                "high_severity_count": high_count
            })

        return sorted(clusters, key=lambda x: x["convergence_score"], reverse=True)

    def get_convergence_zones(self) -> List[Dict]:
        """Detect regional convergence"""
        regions = {
            "middle_east": ["IR", "IL", "SA", "AE", "IQ", "SY", "YE"],
            "east_asia": ["CN", "TW", "JP", "KR", "KP"],
            "south_asia": ["IN", "PK", "BD", "AF", "MM"],
            "eastern_europe": ["UA", "RU", "BY", "PL"]
        }

        clusters = self.get_country_clusters()
        country_map = {c["country"]: c for c in clusters}

        zones = []
        for region, countries in regions.items():
            region_signals = []
            active_countries = []

            for country in countries:
                if country in country_map:
                    region_signals.append(country_map[country])
                    active_countries.append(country)

            if len(active_countries) >= 2:
                all_types = set()
                total_signals = 0
                for c in region_signals:
                    all_types.update(c["types"])
                    total_signals += c["signals"]

                if len(all_types) >= 2:
                    zones.append({
                        "region": region,
                        "countries": active_countries,
                        "signal_types": list(all_types),
                        "total_signals": total_signals
                    })

        return zones

    def _prune_old(self):
        """Remove signals older than window"""
        cutoff = datetime.utcnow() - timedelta(hours=self.window_hours)
        self.signals = [s for s in self.signals if s.timestamp > cutoff]

    def clear(self):
        """Clear all signals"""
        self.signals = []
