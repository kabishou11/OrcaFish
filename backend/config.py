"""OrcaFish — Unified Configuration (pydantic-settings)"""
from pathlib import Path
from typing import Optional

from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


_BACKEND_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _BACKEND_DIR.parent


class LLMSettings(BaseModel):
    provider: str = "modelscope"
    api_key: str = ""
    base_url: str = "https://api-inference.modelscope.cn/v1"
    model: str = "Qwen/Qwen3.5-35B-A3B"
    timeout: int = 300
    reasoning_split: bool = False


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
    # 1. 保留 nested 结构，继续兼容 QUERY_LLM__API_KEY 这类旧配置
    # 2. 同时提供扁平字段，兼容当前 .env.example
    query_llm: LLMSettings = LLMSettings()
    media_llm: LLMSettings = LLMSettings()
    insight_llm: LLMSettings = LLMSettings()
    report_llm: LLMSettings = LLMSettings()

    query_llm_provider: Optional[str] = None
    query_llm_api_key: Optional[str] = None
    query_llm_base_url: Optional[str] = None
    query_llm_model: Optional[str] = None
    query_llm_timeout: Optional[int] = None
    query_llm_reasoning_split: Optional[bool] = None

    media_llm_provider: Optional[str] = None
    media_llm_api_key: Optional[str] = None
    media_llm_base_url: Optional[str] = None
    media_llm_model: Optional[str] = None
    media_llm_timeout: Optional[int] = None
    media_llm_reasoning_split: Optional[bool] = None

    insight_llm_provider: Optional[str] = None
    insight_llm_api_key: Optional[str] = None
    insight_llm_base_url: Optional[str] = None
    insight_llm_model: Optional[str] = None
    insight_llm_timeout: Optional[int] = None
    insight_llm_reasoning_split: Optional[bool] = None

    report_llm_provider: Optional[str] = None
    report_llm_api_key: Optional[str] = None
    report_llm_base_url: Optional[str] = None
    report_llm_model: Optional[str] = None
    report_llm_timeout: Optional[int] = None
    report_llm_reasoning_split: Optional[bool] = None

    # ── Knowledge Graph — Zep CE / Graphiti (本地 Docker) ──────────
    zep_api_key: str = ""
    zep_base_url: str = "http://localhost:8000"
    graphiti_base_url: str = "http://localhost:8003"
    zep_api_secret: str = ""

    # ── Crawl4AI 本地服务 ────────────────────────────────
    crawl4ai_base_url: str = "http://localhost:11235"
    crawl4ai_token: str = ""

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

    def model_post_init(self, __context) -> None:
        self.query_llm = self._merge_llm(self.query_llm, "query_llm")
        self.media_llm = self._merge_llm(self.media_llm, "media_llm")
        self.insight_llm = self._merge_llm(self.insight_llm, "insight_llm")
        self.report_llm = self._merge_llm(self.report_llm, "report_llm")

    def _merge_llm(self, current: LLMSettings, prefix: str) -> LLMSettings:
        data = current.model_dump()
        for field in ("provider", "api_key", "base_url", "model", "timeout", "reasoning_split"):
            flat_value = getattr(self, f"{prefix}_{field}", None)
            if flat_value is not None:
                data[field] = flat_value
        return LLMSettings(**data)


settings = Settings()
