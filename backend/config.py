"""OrcaFish — Unified Configuration (pydantic-settings)"""
import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


# Resolve the .env file relative to THIS file (not CWD)
_BACKEND_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _BACKEND_DIR.parent


class LLMSettings(BaseSettings):
    provider: str = "modelscope"
    api_key: str = ""
    base_url: str = "https://api-inference.modelscope.cn/v1"
    model: str = "Qwen/Qwen3.5-35B-A3B"
    timeout: int = 300


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        env_nested_delimiter="__",
        extra="ignore",
    )

    # ── App ──────────────────────────────────────────────
    app_host: str = "0.0.0.0"
    app_port: int = 8080
    debug: bool = True

    # ── LLM Providers ───────────────────────────────────
    query_llm: LLMSettings = LLMSettings()
    media_llm: LLMSettings = LLMSettings()
    insight_llm: LLMSettings = LLMSettings()
    report_llm: LLMSettings = LLMSettings()

    # ── Knowledge Graph ─────────────────────────────────
    zep_api_key: str = ""

    # ── Data Sources ───────────────────────────────────
    upstash_redis_rest_url: str = ""
    upstash_redis_rest_token: str = ""
    acled_access_token: str = ""
    ucdp_access_token: str = ""
    tavily_api_key: str = ""
    database_url: str = ""

    # ── Trigger Thresholds ──────────────────────────────
    cii_threshold: float = 65.0
    convergence_min_signals: int = 3
    cooldown_seconds: int = 3600
    worldmonitor_poll_interval: int = 300
    military_zscore_threshold: float = 2.0

    # ── Simulation ──────────────────────────────────────
    simulation_rounds: int = 40
    simulation_timeout: int = 3600


settings = Settings()
