"""News Event Clustering — ported from worldmonitor clustering.ts"""
from collections import defaultdict
from typing import Optional
from backend.models.intelligence import ClusteredEvent


def tokenize(text: str) -> set[str]:
    """Simple tokenization"""
    return set(
        w.lower().strip() for w in text.split()
        if len(w) > 2 and w.isalpha()
    )


def jaccard_similarity(a: set[str], b: set[str]) -> float:
    """Jaccard similarity between two token sets"""
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


class NewsCluster:
    """Clusters news items by title/content similarity"""

    def __init__(self, similarity_threshold: float = 0.3):
        self._threshold = similarity_threshold
        self._items: list[dict] = []
        self._clusters: list[list[int]] = []

    def ingest(self, items: list[dict]):
        """Ingest news items: list of {title, source, pub_date, threat, lat, lon}"""
        self._items.extend(items)

    def cluster(self) -> list[ClusteredEvent]:
        """Perform Jaccard clustering and return events"""
        if not self._items:
            return []

        tokens = [tokenize(item.get("title", "")) for item in self._items]

        # Single-linkage clustering
        clusters: list[set[int]] = [set([i]) for i in range(len(tokens))]
        merged = True

        while merged and len(clusters) > 1:
            merged = False
            to_merge: tuple[int, int] | None = None
            max_sim = self._threshold

            for i in range(len(clusters)):
                for j in range(i + 1, len(clusters)):
                    # Average similarity between all pairs in two clusters
                    sims = []
                    for a in clusters[i]:
                        for b in clusters[j]:
                            sims.append(jaccard_similarity(tokens[a], tokens[b]))
                    if sims:
                        avg_sim = sum(sims) / len(sims)
                        if avg_sim > max_sim:
                            max_sim = avg_sim
                            to_merge = (i, j)
                            merged = True

            if to_merge:
                i, j = to_merge
                clusters[i] |= clusters[j]
                clusters.pop(j)

        # Build ClusteredEvent from clusters
        events = []
        for idx, cluster_indices in enumerate(clusters):
            items = [self._items[i] for i in cluster_indices]
            primary = items[0]
            events.append(ClusteredEvent(
                id=f"evt_{idx:04d}",
                primary_title=primary.get("title", "Unknown Event"),
                source_count=len(items),
                threat=primary.get("threat", "low"),
                lat=primary.get("lat"),
                lon=primary.get("lon"),
                velocity=len(items) / 24.0,  # sources per hour
            ))

        events.sort(key=lambda e: e.source_count * e.velocity, reverse=True)
        return events
