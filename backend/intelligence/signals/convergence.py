"""Convergence detection logic"""
from typing import List, Dict


def detect_convergence(clusters: List[Dict], threshold: int = 50) -> List[Dict]:
    """Detect countries with converging signals"""
    return [c for c in clusters if c.get("convergence_score", 0) >= threshold]
