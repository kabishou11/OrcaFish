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

    # ── Knowledge Graph — Zep CE (本地 Docker) ──────────
    # Cloud key 保留做回退，本地优先
    zep_api_key: str = ""
    zep_base_url: str = "http://localhost:8000"   # Zep CE 服务地址
    zep_api_secret: str = ""                       # zep.yaml 中 api_secret

    # ── Crawl4AI 本地服务 ────────────────────────────────
    crawl4ai_base_url: str = "http://localhost:11235"
    crawl4ai_token: str = ""                       # 若 config.yml 配了 JWT

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
