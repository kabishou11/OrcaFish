"""OrcaFish Unified LLM Client — supports OpenAI-compatible providers"""
import os
import json
import asyncio
from typing import Optional, Generator, Any, Dict
from openai import AsyncOpenAI, RateLimitError
from loguru import logger


class LLMClient:
    """
    Unified LLM client supporting multiple providers.
    Based on BettaFish's QueryEngine/llms/base.py and config.py architecture.
    Supports: OpenAI, DeepSeek, Gemini, Kimi, Qwen (all OpenAI-compatible APIs).
    """

    PROVIDER_CONFIGS: Dict[str, Dict[str, Any]] = {
        "openai": {
            "api_type": "openai",
            "api_version": None,
            "base_url": None,  # uses default OpenAI endpoint
        },
        "deepseek": {
            "api_type": "openai",
            "api_version": None,
            "base_url": "https://api.deepseek.com",
        },
        "gemini": {
            "api_type": "openai",
            "api_version": None,
            "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        },
        "kimi": {
            "api_type": "openai",
            "api_version": None,
            "base_url": "https://api.moonshot.cn/v1",
        },
        "qwen": {
            "api_type": "openai",
            "api_version": None,
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        },
        "modelscope": {
            "api_type": "openai",
            "api_version": None,
            "base_url": "https://api-inference.modelscope.cn/v1",
        },
        "minimax": {
            "api_type": "openai",
            "api_version": None,
            "base_url": "https://api.minimaxi.com/v1",
        },
    }

    PROVIDER_ENV_KEYS: Dict[str, list[str]] = {
        "modelscope": ["MODELSCOPE_API_KEY"],
        "minimax": ["MINIMAX_API_KEY"],
        "openai": ["OPENAI_API_KEY"],
        "deepseek": ["DEEPSEEK_API_KEY"],
        "gemini": ["GEMINI_API_KEY"],
        "kimi": ["KIMI_API_KEY"],
        "qwen": ["QWEN_API_KEY"],
    }

    def __init__(
        self,
        api_key: str = "",
        base_url: str = "",
        model: str = "gpt-4o",
        provider: str = "openai",
        timeout: int = 180,
        max_retries: int = 3,
        reasoning_split: bool = False,
    ):
        """
        Initialize the unified LLM client.

        Args:
            api_key: API key. Falls back to LLM_API_KEY env var.
            base_url: Override base URL. If empty, resolved from provider.
            model: Model name (e.g. "gpt-4o", "deepseek-chat", "gemini-2.5-pro").
            provider: Provider key from PROVIDER_CONFIGS.
            timeout: Request timeout in seconds.
            max_retries: Max retry attempts on RateLimitError.
        """
        # Try multiple common env var names as fallback
        _env_keys = [
            *self.PROVIDER_ENV_KEYS.get(provider, []),
            "LLM_API_KEY",
            "OPENAI_API_KEY",
            "MODELSCOPE_API_KEY",
            "DEEPSEEK_API_KEY",
            "GEMINI_API_KEY",
            "KIMI_API_KEY",
            "MINIMAX_API_KEY",
            "API_KEY",
            "OPENAI_KEY",
        ]
        _fallback_key = next((os.getenv(k) for k in _env_keys if os.getenv(k)), "")
        self.api_key = api_key or _fallback_key
        self.model = model
        self.provider = provider
        self.timeout = timeout
        self.max_retries = max_retries
        self.reasoning_split = reasoning_split

        # Resolve effective base URL
        if base_url:
            effective_url = base_url
        elif provider in self.PROVIDER_CONFIGS:
            effective_url = self.PROVIDER_CONFIGS[provider].get("base_url") or ""
        else:
            effective_url = ""

        client_kwargs: Dict[str, Any] = {
            "api_key": self.api_key,
            "timeout": timeout,
            "max_retries": 0,  # we handle retries manually
        }
        if effective_url:
            client_kwargs["base_url"] = effective_url

        self._client = AsyncOpenAI(**client_kwargs)
        logger.info(
            f"LLMClient initialized | provider={provider} model={model} url={effective_url or 'default'}"
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def invoke(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> str:
        """
        Single-shot completion with automatic retry on rate-limit.

        Args:
            system_prompt: System prompt.
            user_prompt: User prompt.
            temperature: Sampling temperature (0.0–2.0).
            max_tokens: Max new tokens to generate.

        Returns:
            The assistant's text response.
        """
        for attempt in range(self.max_retries):
            try:
                response = await self._client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=temperature,
                    max_tokens=max_tokens,
                    extra_body={"reasoning_split": True} if self.reasoning_split else None,
                )
                content = response.choices[0].message.content
                return content if content is not None else ""
            except RateLimitError:
                wait = 2 ** attempt
                logger.warning(
                    f"[LLMClient] Rate limited, retrying in {wait}s "
                    f"(attempt {attempt + 1}/{self.max_retries})"
                )
                await asyncio.sleep(wait)
            except Exception as e:
                logger.error(f"[LLMClient] invoke error: {e}")
                if attempt == self.max_retries - 1:
                    raise
                await asyncio.sleep(2 * (attempt + 1))
        return ""

    async def stream_invoke(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
    ) -> Generator[str, None, None]:
        """
        Streaming completion — yields text chunks as they arrive.

        Yields:
            Text delta chunks.
        """
        stream = await self._client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            stream=True,
            extra_body={"reasoning_split": True} if self.reasoning_split else None,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def invoke_json(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
    ) -> dict:
        """
        Request structured JSON output.

        The prompt is suffixed to request JSON; the response is parsed.
        Falls back to extracting JSON from markdown code fences.

        Returns:
            Parsed dict from the response.

        Raises:
            json.JSONDecodeError: If parsing fails.
        """
        response = await self.invoke(
            system_prompt=system_prompt
            + "\n\nYou must respond with valid JSON only. No markdown, no explanation.",
            user_prompt=user_prompt,
            temperature=temperature,
            max_tokens=4096,
        )
        text = response.strip()

        # Strip markdown code fences
        if text.startswith("```"):
            parts = text.split("```", 2)
            if len(parts) >= 3:
                text = parts[1]
                # Remove optional "json" language tag
                if text.startswith("json"):
                    text = text[4:]
        return json.loads(text)

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def get_model_info(self) -> Dict[str, str]:
        """Return provider/model metadata for logging."""
        return {
            "provider": self.provider,
            "model": self.model,
            "api_base": self._client.base_url or "default",
        }
