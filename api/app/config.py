"""Configuration. Everything the app needs comes from the environment."""
from __future__ import annotations

import os
from datetime import date
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))


class Settings:
    dsn_ro: str = os.getenv("DATABASE_URL_RO", "postgresql://copilot_ro:copilot_ro@localhost:5434/copilot")
    dsn_rw: str = os.getenv("DATABASE_URL_RW", "postgresql://copilot_rw:copilot_rw@localhost:5434/copilot")
    dsn_admin: str = os.getenv("DATABASE_URL_ADMIN", "postgresql://postgres:postgres@localhost:5434/copilot")
    model: str = os.getenv("COPILOT_MODEL", "claude-sonnet-5-5")
    anthropic_key: str | None = os.getenv("ANTHROPIC_API_KEY") or None

    #: The dataset ends here. "Overdue", "this year" and "last 10 months" are all
    #: measured against this date, never against the wall clock — otherwise the
    #: demo starts answering differently as real time moves on.
    reference_date: date = date.fromisoformat(os.getenv("REFERENCE_DATE", "2026-10-31"))

    #: Hard ceiling on any row-returning tool. The model never sees more.
    max_rows: int = 200


@lru_cache
def settings() -> Settings:
    return Settings()
