"""Data models for agent responses."""

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class RunResult:
    summary: Optional[str] = None
    tool_events: List[str] = field(default_factory=list)
    raw_response: Optional[str] = None
