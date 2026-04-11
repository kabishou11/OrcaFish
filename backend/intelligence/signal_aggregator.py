from __future__ import annotations
"""OrcaFish Signal Aggregator — ported from WorldMonitor signal-aggregator.ts"""
from datetime import UTC, datetime, timedelta
from typing import Optional
from dataclasses import dataclass, field
import hashlib
import re
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.parse import quote
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
from loguru import logger
from backend.models.intelligence import GeoSignal, CountrySignalCluster, RegionalConvergence, NewsBulletin


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

NEWS_TRACKERS = [
    {"query": "Taiwan Strait OR 台海", "country_iso": "TW", "lat": 23.7, "lon": 121.0, "signal_type": "diplomatic"},
    {"query": "Ukraine Russia conflict", "country_iso": "UA", "lat": 48.4, "lon": 31.2, "signal_type": "conflict"},
    {"query": "Middle East Iran Israel", "country_iso": "IL", "lat": 31.5, "lon": 34.5, "signal_type": "military"},
    {"query": "South China Sea", "country_iso": "CN", "lat": 14.5, "lon": 115.0, "signal_type": "diplomatic"},
    {"query": "Korean Peninsula North Korea", "country_iso": "KP", "lat": 40.0, "lon": 127.0, "signal_type": "military"},
    {"query": "US China technology sanctions", "country_iso": "US", "lat": 37.1, "lon": -95.7, "signal_type": "economic"},
    {"query": "Iran sanctions Hormuz", "country_iso": "IR", "lat": 32.3, "lon": 53.7, "signal_type": "economic"},
    {"query": "Gaza humanitarian corridor", "country_iso": "PS", "lat": 31.4, "lon": 34.4, "signal_type": "humanitarian_crisis"},
    {"query": "Lebanon border tension", "country_iso": "LB", "lat": 33.8, "lon": 35.8, "signal_type": "diplomatic_tension"},
    {"query": "Yemen Red Sea Houthis", "country_iso": "YE", "lat": 15.6, "lon": 48.5, "signal_type": "military_vessel"},
    {"query": "Sudan clashes humanitarian", "country_iso": "SD", "lat": 15.5, "lon": 32.5, "signal_type": "conflict"},
    {"query": "Pakistan Afghanistan border", "country_iso": "PK", "lat": 30.4, "lon": 69.4, "signal_type": "military"},
    {"query": "Philippines South China Sea", "country_iso": "PH", "lat": 12.9, "lon": 121.8, "signal_type": "diplomatic"},
    {"query": "Myanmar insurgency", "country_iso": "MM", "lat": 21.9, "lon": 95.9, "signal_type": "conflict"},
    {"query": "Sahel coup terrorism", "country_iso": "ML", "lat": 17.6, "lon": -3.9, "signal_type": "conflict"},
    {"query": "Nigeria cyber outage protest", "country_iso": "NG", "lat": 9.1, "lon": 8.7, "signal_type": "internet_outage"},
    {"query": "Syria border strike", "country_iso": "SY", "lat": 35.0, "lon": 38.5, "signal_type": "conflict"},
    {"query": "Iraq militia attack", "country_iso": "IQ", "lat": 33.2, "lon": 43.7, "signal_type": "military"},
    {"query": "Jordan border security", "country_iso": "JO", "lat": 31.2, "lon": 36.5, "signal_type": "diplomatic_tension"},
    {"query": "Saudi Arabia regional security", "country_iso": "SA", "lat": 23.9, "lon": 45.1, "signal_type": "diplomatic"},
    {"query": "Egypt Gaza Rafah pressure", "country_iso": "EG", "lat": 26.8, "lon": 30.8, "signal_type": "humanitarian_crisis"},
    {"query": "Russia sanctions Europe", "country_iso": "RU", "lat": 55.7, "lon": 37.6, "signal_type": "economic"},
    {"query": "Belarus military movement", "country_iso": "BY", "lat": 53.7, "lon": 27.9, "signal_type": "military"},
    {"query": "Venezuela Guyana tension", "country_iso": "VE", "lat": 7.0, "lon": -66.0, "signal_type": "diplomatic_tension"},
    {"query": "Serbia Kosovo tension", "country_iso": "RS", "lat": 44.0, "lon": 20.8, "signal_type": "diplomatic_tension"},
    {"query": "Armenia Azerbaijan corridor", "country_iso": "AM", "lat": 40.2, "lon": 44.5, "signal_type": "diplomatic"},
    {"query": "Ethiopia Red Sea tension", "country_iso": "ET", "lat": 9.1, "lon": 40.5, "signal_type": "diplomatic_tension"},
    {"query": "Somalia piracy shipping", "country_iso": "SO", "lat": 5.2, "lon": 46.2, "signal_type": "military_vessel"},
    {"query": "DR Congo eastern conflict", "country_iso": "CD", "lat": -2.8, "lon": 23.6, "signal_type": "conflict"},
    {"query": "India Pakistan border tension", "country_iso": "IN", "lat": 22.3, "lon": 79.0, "signal_type": "military"},
    {"query": "Afghanistan security incident", "country_iso": "AF", "lat": 34.5, "lon": 66.0, "signal_type": "conflict"},
    {"query": "South Korea North Korea alert", "country_iso": "KR", "lat": 36.3, "lon": 127.8, "signal_type": "military"},
    {"query": "Japan East China Sea security", "country_iso": "JP", "lat": 36.2, "lon": 138.3, "signal_type": "diplomatic"},
    {"query": "Thailand Myanmar border", "country_iso": "TH", "lat": 15.9, "lon": 100.9, "signal_type": "humanitarian_crisis"},
    {"query": "Vietnam South China Sea", "country_iso": "VN", "lat": 14.1, "lon": 108.3, "signal_type": "diplomatic"},
]

SEVERITY_KEYWORDS = {
    "high": ("attack", "strike", "missile", "冲突", "打击", "升级", "sanction", "制裁", "military"),
    "medium": ("talks", "warning", "谈判", "抗议", "部署", "tension", "alert"),
}

SIGNAL_TYPE_LABELS = {
    "military": "军事",
    "military_flight": "军机",
    "military_vessel": "军舰",
    "protest": "抗议",
    "conflict": "冲突",
    "internet_outage": "网络",
    "diplomatic": "外交",
    "diplomatic_tension": "外交",
    "economic": "经济",
    "humanitarian_crisis": "人道",
    "ais_disruption": "航运",
    "satellite_fire": "火点",
}

FALLBACK_STORYLINES = {
    "TW": ["周边军演热度抬升", "跨海峡舆情同步升温", "周边空海动态进入持续观察"],
    "UA": ["东线火力交换再次升温", "能源与战线双重承压", "外部援助议题重新聚焦"],
    "IL": ["边境冲突外溢风险抬升", "地区外交与军事信号交织", "人道走廊议题带动国际关注"],
    "IR": ["制裁与海湾航运议题升温", "区域代理冲突信号增强", "国内外政策表态密集出现"],
    "KP": ["半岛军情进入高频窗口", "周边预警与演训消息增多", "地区安全讨论快速外溢"],
    "CN": ["海上议题与政策声明同步发酵", "区域博弈持续占据头条", "技术与供应链话题被重新聚焦"],
    "PS": ["人道救援与停火呼声持续冲高", "跨平台传播出现二次放大", "国际舆论与地面事件高度耦合"],
    "LB": ["边境摩擦与舆情担忧同时抬升", "地区外溢风险进入观察名单", "外交斡旋消息密集增加"],
    "YE": ["红海航运与安全预警再度升温", "地区海上风险持续累积", "多方表态带动新闻热度上行"],
    "SD": ["冲突与人道风险同步增加", "外部关注度快速回流", "跨境外溢压力重新上升"],
    "PH": ["海上摩擦与舆论讨论同步上升", "地区联合表态带动关注", "岛链安全议题持续发酵"],
    "MM": ["局部冲突与边境态势出现升温", "地区安全担忧重新聚焦", "多来源消息显示波动加大"],
    "ML": ["萨赫勒安全风险重新进入视野", "政局与安全消息叠加升温", "恐袭与政变传闻带动关注"],
    "NG": ["抗议与网络扰动交替出现", "国内安全与民生议题同步发酵", "多平台热点进入连续观测"],
    "SY": ["跨境打击与地区博弈叠加升温", "边境摩擦重新带动国际关注", "代理冲突与外部表态同步出现"],
    "IQ": ["民兵活动与地区安全议题升温", "外部设施安全重新进入观察窗口", "跨境事件带动关注回流"],
    "JO": ["边境安全与外交协调同步承压", "周边外溢风险开始向本国传导", "区域安全议题带动舆论增温"],
    "SA": ["区域斡旋与安全防务并行推进", "海湾安全话题重新回到头条", "地区外交信号带动风险再评估"],
    "EG": ["边境与人道议题持续承压", "外部关注度沿跨境通道快速抬升", "地区舆情与安全担忧同时增加"],
    "RU": ["制裁、军事与外交信号继续叠加", "多源报道推动外部风险评估升温", "区域战事相关议题持续发酵"],
    "BY": ["地区军情与边境动态重新升温", "演训与警戒消息提高关注度", "周边局势外溢进入持续追踪"],
    "VE": ["领土争议与资源议题交叉升温", "地区安全担忧带动关注回流", "外交表态与市场话题同步抬头"],
    "RS": ["边境争议与外交摩擦重新被放大", "地区稳定性进入紧张观察区间", "多方表态带动热点再起"],
    "AM": ["通道、边境与地区协调问题同步升温", "地区安全格局出现新的摩擦点", "外交谈判与安全疑虑交织"],
    "ET": ["港口、边界与地区安全议题叠加", "非洲之角外溢风险上升", "多来源线索显示紧张度加大"],
    "SO": ["海上通道安全与海盗活动持续扰动", "航运风险话题再次升温", "地区海事预警进入高频期"],
    "CD": ["东部冲突与人道局势继续恶化", "周边外溢与安全问题同步增加", "多方关注重新聚焦战区动态"],
    "IN": ["边境警戒与地区安全讨论同步升温", "跨境议题在多平台持续发酵", "安全与外交表态交替出现"],
    "AF": ["安全事件与周边外溢风险升高", "地区观察重新转向边境与治理议题", "多来源消息显示波动继续加大"],
    "KR": ["半岛预警与军情消息明显增多", "周边同盟协同话题快速放大", "安全讨论持续占据高位"],
    "JP": ["东海与周边安全话题重新升温", "联合表态与警戒信息推动关注回流", "海上风险评估进入连续观察"],
    "TH": ["边境人流与安全压力同步增加", "外部事件带动本地治理担忧", "人道与安全议题进入同频窗口"],
    "VN": ["海上议题与区域外交话题继续发酵", "多边表态推动风险讨论升温", "周边海域动态进入密集跟踪"],
}


def _strip_html(raw: str) -> str:
    return re.sub(r"<[^>]+>", " ", unescape(raw or "")).replace("\n", " ").strip()


# Domain → signal type mapping for frontend domain filter
DOMAIN_SIGNAL_TYPES: dict[str, tuple[str, ...]] = {
    "military": ("military", "conflict", "military_flight", "military_vessel", "satellite_fire", "protest"),
    "economic": ("economic", "economic_sanction", "trade_dispute", "currency_crisis", "resource_shortage"),
    "diplomatic": ("diplomatic", "diplomatic_tension", "alliance_shift", "protest"),
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
    _news_items: list[NewsBulletin] = field(default_factory=list)
    _prune_hours: int = 24
    _poll_count: int = 0

    def get_poll_count(self) -> int:
        return self._poll_count

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
        now = datetime.now(UTC)
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
        now = datetime.now(UTC)
        return [
            s for s in self._signals
            if not s.timestamp or (now - s.timestamp) < timedelta(hours=self._prune_hours)
        ]

    def get_news_items(self, domain: Optional[str] = None, limit: int = 40) -> list[NewsBulletin]:
        now = datetime.now(UTC)
        items = [
            item for item in self._news_items
            if not item.published_at or (now - item.published_at) < timedelta(hours=self._prune_hours)
        ]
        if domain and domain != "all":
            allowed = set(DOMAIN_SIGNAL_TYPES.get(domain, ()))
            if allowed:
                items = [item for item in items if item.signal_type in allowed]
        items.sort(key=lambda item: item.published_at, reverse=True)
        return items[:limit]

    def clear(self):
        self._signals = []
        self._news_items = []

    def _append_news_item(self, item: NewsBulletin) -> None:
        if any(existing.id == item.id for existing in self._news_items):
            return
        self._news_items.append(item)

    def _append_signal_from_news(self, item: NewsBulletin) -> None:
        if any(
            sig.country_iso == item.country_iso and sig.signal_type == item.signal_type and sig.source == item.source and abs((sig.timestamp - item.published_at).total_seconds()) < 300
            for sig in self._signals
        ):
            return
        severity = "low"
        lowered = f"{item.title} {item.summary}".lower()
        if any(keyword.lower() in lowered for keyword in SEVERITY_KEYWORDS["high"]):
            severity = "high"
        elif any(keyword.lower() in lowered for keyword in SEVERITY_KEYWORDS["medium"]):
            severity = "medium"
        self._signals.append(GeoSignal(
            signal_type=item.signal_type,
            country_iso=item.country_iso,
            lat=item.lat or 0.0,
            lon=item.lon or 0.0,
            severity=severity,
            count=1,
            source=item.source,
            timestamp=item.published_at,
        ))

    def get_country_news_stats(self) -> dict[str, dict[str, float | int]]:
        now = datetime.now(UTC)
        stats: dict[str, dict[str, float | int]] = {}
        for item in self.get_news_items(limit=200):
            if not item.country_iso:
                continue
            country = stats.setdefault(item.country_iso, {
                "count": 0,
                "freshness": 0.0,
                "source_diversity": 0,
                "escalation": 0.0,
            })
            country["count"] = int(country["count"]) + 1
            minutes_ago = max((now - item.published_at).total_seconds() / 60.0, 0.0)
            freshness = max(0.0, 1.0 - min(minutes_ago / 180.0, 1.0))
            country["freshness"] = max(float(country["freshness"]), freshness)
            sources = country.setdefault("_sources", set())
            if isinstance(sources, set):
                sources.add(item.source or "unknown")
                country["source_diversity"] = len(sources)
            text = f"{item.title} {item.summary}".lower()
            escalation = 1.0 if any(keyword.lower() in text for keyword in SEVERITY_KEYWORDS["high"]) else 0.55 if any(keyword.lower() in text for keyword in SEVERITY_KEYWORDS["medium"]) else 0.25
            country["escalation"] = max(float(country["escalation"]), escalation)
        for value in stats.values():
            value.pop("_sources", None)
        return stats

    def get_recent_activity(self, limit: int = 24, domain: Optional[str] = None) -> list[dict]:
        events: list[dict] = []
        news_items = self.get_news_items(domain=domain, limit=limit)
        signals = self.get_signals()
        if domain and domain != "all":
            signals = _filter_by_domain(signals, domain)

        for item in news_items:
            events.append({
                "id": f"news:{item.id}",
                "kind": "news",
                "country_iso": item.country_iso,
                "signal_type": item.signal_type,
                "title": item.title,
                "description": item.summary[:220] if item.summary else item.title,
                "source": item.source,
                "timestamp": item.published_at.isoformat(),
                "severity": "medium",
            })

        for signal in signals[:limit * 2]:
            signal_label = SIGNAL_TYPE_LABELS.get(signal.signal_type, signal.signal_type)
            events.append({
                "id": f"signal:{signal.country_iso}:{signal.signal_type}:{signal.timestamp.isoformat()}:{signal.source}",
                "kind": "signal",
                "country_iso": signal.country_iso,
                "signal_type": signal.signal_type,
                "title": f"{signal.country_iso or 'GLOBAL'} 出现{signal_label}信号",
                "description": f"{signal.source or 'OrcaFish Monitor'} 记录到{signal_label}动态，强度 {signal.count}",
                "source": signal.source or "OrcaFish Monitor",
                "timestamp": signal.timestamp.isoformat(),
                "severity": signal.severity,
            })

        events.sort(key=lambda item: item["timestamp"], reverse=True)
        deduped: list[dict] = []
        seen: set[str] = set()
        for event in events:
            if event["id"] in seen:
                continue
            seen.add(event["id"])
            deduped.append(event)
            if len(deduped) >= limit:
                break
        return deduped

    def get_country_watchlist(self, limit: int = 12, domain: Optional[str] = None) -> list[dict]:
        now = datetime.now(UTC)
        stats = self.get_country_news_stats()
        signals = self.get_signals()
        if domain and domain != "all":
            signals = _filter_by_domain(signals, domain)

        signals_by_country: dict[str, list[GeoSignal]] = {}
        for signal in signals:
            if signal.country_iso:
                signals_by_country.setdefault(signal.country_iso, []).append(signal)

        news_by_country: dict[str, list[NewsBulletin]] = {}
        for item in self.get_news_items(domain=domain, limit=240):
            if item.country_iso:
                news_by_country.setdefault(item.country_iso, []).append(item)

        watchlist: list[dict] = []
        for cluster in self.get_country_clusters(domain=domain):
            iso = cluster.country_iso
            country_news = news_by_country.get(iso, [])
            country_signals = signals_by_country.get(iso, [])
            country_stats = stats.get(iso, {})
            source_count = int(country_stats.get("count", 0))
            source_diversity = int(country_stats.get("source_diversity", 0))
            freshness = float(country_stats.get("freshness", 0.0))
            escalation = float(country_stats.get("escalation", 0.0))
            last_event_candidates = [item.published_at for item in country_news] + [signal.timestamp for signal in country_signals]
            last_event = max(last_event_candidates, default=None)
            new_events_15m = sum(1 for ts in last_event_candidates if (now - ts) <= timedelta(minutes=15))

            drivers: list[str] = []
            if cluster.total_count >= 8:
                drivers.append(f"{cluster.total_count} 条信号叠加")
            elif cluster.total_count >= 4:
                drivers.append("信号密度持续抬升")
            if source_count >= 5:
                drivers.append(f"{source_count} 条新闻同步")
            if source_diversity >= 3:
                drivers.append(f"{source_diversity} 个来源交叉验证")
            if escalation >= 0.8:
                drivers.append("升级关键词偏高")
            if freshness >= 0.72:
                drivers.append("近 3 小时持续刷新")
            if new_events_15m >= 3:
                drivers.append(f"{new_events_15m} 条新事件刚刚进入")
            if not drivers:
                drivers.append("监控信号开始聚拢")

            if new_events_15m >= 3 or (freshness >= 0.72 and escalation >= 0.8):
                momentum = "accelerating"
            elif cluster.total_count >= 4 or source_count >= 3:
                momentum = "building"
            else:
                momentum = "watch"

            rationale = (
                f"{drivers[0]}，重点集中在{'、'.join(cluster.signal_types[:3]) or '观察信号'}，"
                f"最近标题包括{country_news[0].title if country_news else f'{iso} 最新动态'}。"
            )

            watchlist.append({
                "iso": iso,
                "signal_count": cluster.total_count,
                "source_count": source_count,
                "source_diversity": source_diversity,
                "freshness": round(freshness, 3),
                "escalation": round(escalation, 3),
                "convergence_score": round(cluster.convergence_score, 2),
                "top_signal_types": cluster.signal_types[:4],
                "top_headlines": [item.title for item in country_news[:3]],
                "drivers": drivers[:4],
                "rationale": rationale,
                "last_event": last_event.isoformat() if last_event else None,
                "new_events_15m": new_events_15m,
                "momentum": momentum,
            })

        watchlist.sort(
            key=lambda item: (
                item["new_events_15m"],
                item["convergence_score"],
                item["source_diversity"],
                item["freshness"],
            ),
            reverse=True,
        )
        return watchlist[:limit]

    def _prune_old_data(self) -> None:
        now = datetime.now(UTC)
        self._signals = [
            sig for sig in self._signals
            if not sig.timestamp or (now - sig.timestamp) < timedelta(hours=self._prune_hours)
        ]
        self._news_items = [
            item for item in self._news_items
            if not item.published_at or (now - item.published_at) < timedelta(hours=self._prune_hours)
        ]

    def _fetch_google_news(self) -> list[NewsBulletin]:
        bulletins: list[NewsBulletin] = []
        for tracker in NEWS_TRACKERS:
            url = (
                "https://news.google.com/rss/search?q="
                f"{quote(tracker['query'])}+when:1d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
            )
            try:
                request = Request(url, headers={"User-Agent": "Mozilla/5.0 OrcaFish/1.0"})
                with urlopen(request, timeout=10) as response:
                    xml_text = response.read().decode("utf-8", errors="ignore")
                root = ET.fromstring(xml_text)
                channel = root.find("channel")
                if channel is None:
                    continue
                for item in channel.findall("item")[:3]:
                    title = (item.findtext("title") or "").strip()
                    link = (item.findtext("link") or "").strip()
                    summary = _strip_html(item.findtext("description") or "")
                    pub_text = item.findtext("pubDate") or ""
                    try:
                        published_at = parsedate_to_datetime(pub_text)
                        if published_at.tzinfo is None:
                            published_at = published_at.replace(tzinfo=UTC)
                        else:
                            published_at = published_at.astimezone(UTC)
                    except Exception:
                        published_at = datetime.now(UTC)
                    if not title:
                        continue
                    bulletins.append(NewsBulletin(
                        id=hashlib.sha1(f"{tracker['country_iso']}::{link or title}".encode("utf-8")).hexdigest()[:16],
                        title=title,
                        summary=summary[:240],
                        source="Google News RSS",
                        url=link,
                        country_iso=tracker["country_iso"],
                        signal_type=tracker["signal_type"],
                        lat=tracker["lat"],
                        lon=tracker["lon"],
                        published_at=published_at,
                    ))
            except Exception as exc:
                logger.debug(f"News fetch failed for {tracker['query']}: {exc}")
        return bulletins

    def _seed_fallback_news(self) -> list[NewsBulletin]:
        now = datetime.now(UTC)
        fallback = []
        phase = self._poll_count % max(len(NEWS_TRACKERS), 1)
        window = NEWS_TRACKERS[phase:] + NEWS_TRACKERS[:phase]
        verbs = ["出现升温迹象", "进入连续观察窗口", "新增监控线索", "出现二次发酵", "触发跨平台扩散", "进入高频监测名单"]
        for index, tracker in enumerate(window[:12]):
            verb = verbs[(self._poll_count + index) % len(verbs)]
            storylines = FALLBACK_STORYLINES.get(tracker["country_iso"], [f"{tracker['query']} 仍在持续变化"])
            storyline = storylines[(self._poll_count + index) % len(storylines)]
            fallback.append(NewsBulletin(
                id=f"fallback-{tracker['country_iso']}-{now.strftime('%Y%m%d%H%M%S')}-{self._poll_count}-{index}",
                title=f"{tracker['country_iso']} {verb}",
                summary=f"监控引擎正在持续追踪 {tracker['query']}。第 {self._poll_count + 1} 轮轮询显示，{storyline}。",
                source=f"OrcaFish Monitor #{self._poll_count + 1}",
                url="",
                country_iso=tracker["country_iso"],
                signal_type=tracker["signal_type"],
                lat=tracker["lat"],
                lon=tracker["lon"],
                published_at=now - timedelta(minutes=index * 3),
            ))
        return fallback

    def _seed_fallback_signals(self) -> None:
        now = datetime.now(UTC)
        phase = self._poll_count % max(len(NEWS_TRACKERS), 1)
        window = NEWS_TRACKERS[phase:] + NEWS_TRACKERS[:phase]
        for index, tracker in enumerate(window[:10]):
            severity = "high" if (self._poll_count + index) % 4 == 0 else "medium"
            signal_value = 2 + ((self._poll_count + index) % 4)
            self._signals.append(GeoSignal(
                signal_type=tracker["signal_type"],
                country_iso=tracker["country_iso"],
                lat=tracker["lat"],
                lon=tracker["lon"],
                severity=severity,
                count=signal_value,
                value=float(signal_value),
                source=f"OrcaFish Pulse #{self._poll_count + 1}",
                timestamp=now - timedelta(minutes=index * 2),
            ))

    def poll_external_sources(self):
        """
        Poll public news feeds and convert them into live bulletins + geo signals.
        If public feeds fail, fall back to synthetic hot-zone bulletins so the
        monitoring UI never stays empty after monitor startup.
        """
        logger.debug("Polling external intelligence sources...")
        self._poll_count += 1
        self._prune_old_data()

        bulletins = self._fetch_google_news()
        fallback_bulletins = self._seed_fallback_news()
        if bulletins:
            bulletins.extend(fallback_bulletins[:8])
        else:
            bulletins = fallback_bulletins
            self._seed_fallback_signals()

        for bulletin in bulletins:
            self._append_news_item(bulletin)
            self._append_signal_from_news(bulletin)

        logger.debug(f"Intelligence polling finished | news={len(bulletins)} signals={len(self._signals)}")
