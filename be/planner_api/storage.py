from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from planner_api.models import PlannerMapPayload, PlannerMapResponse


def _slugify_location(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "location"


class PlannerStorage:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _path_for_location(self, location: str) -> Path:
        return self.base_dir / f"{_slugify_location(location)}.json"

    def read(self, location: str) -> PlannerMapResponse:
        path = self._path_for_location(location)

        if not path.exists():
            return PlannerMapResponse(location=location, features=[], updatedAt=None)

        with path.open("r", encoding="utf-8") as file:
            payload = json.load(file)

        return PlannerMapResponse(**payload)

    def write(self, planner_map: PlannerMapPayload) -> PlannerMapResponse:
        updated_at = datetime.now(timezone.utc).isoformat()
        payload = PlannerMapResponse(
            location=planner_map.location,
            features=planner_map.features,
            updatedAt=updated_at,
        )

        path = self._path_for_location(planner_map.location)
        temp_path = path.with_suffix(".tmp")

        with temp_path.open("w", encoding="utf-8") as file:
            json.dump(payload.model_dump(mode="json"), file, indent=2, ensure_ascii=False)

        temp_path.replace(path)

        return payload
