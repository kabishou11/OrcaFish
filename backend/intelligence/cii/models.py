"""CII data models"""
from dataclasses import dataclass
from typing import Optional


@dataclass
class ComponentScores:
    """CII component scores"""
    unrest: float
    conflict: float
    security: float
    information: float


@dataclass
class CIIScore:
    """Country Intelligence Index score"""
    code: str
    name: str
    score: float
    level: str  # low/normal/elevated/high/critical
    trend: str  # rising/stable/falling
    change24h: float
    components: ComponentScores
    last_updated: str
