"""Centralized OpenAI client configuration."""

from __future__ import annotations

import os
from typing import Optional

from openai import AsyncOpenAI

_client: Optional[AsyncOpenAI] = None

LLM_MODEL = os.environ.get("LLM_MODEL", "deepseek-chat")
BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.deepseek.com")


def get_openai_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            api_key=os.environ.get("OPENAI_API_KEY", ""),
            base_url=BASE_URL,
        )
    return _client
