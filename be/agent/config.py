"""Agent configuration and runtime constants."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

LLM_PROVIDER = os.getenv("BACKBOARD_LLM_PROVIDER")
MODEL_NAME = os.getenv("BACKBOARD_MODEL_NAME")
ASSISTANT_ID = os.getenv("BACKBOARD_ASSISTANT_ID")
TOOL_ONLY_NUDGE = "Use tools only. Do not respond in plain text. Call finish(summary) when complete."
