"""Agent configuration and runtime constants."""

import os

from dotenv import load_dotenv

load_dotenv()

LLM_PROVIDER = os.getenv("BACKBOARD_LLM_PROVIDER")
MODEL_NAME = os.getenv("BACKBOARD_MODEL_NAME")
TOOL_ONLY_NUDGE = "Use tools only. Do not respond in plain text. Call finish(summary) when complete."
