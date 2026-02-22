from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


EntityType = Literal["building", "road", "river", "park"]


class PlannerFeature(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    entityType: EntityType
    geometry: dict[str, Any]
    attributes: dict[str, Any] = Field(default_factory=dict)


class PlannerMapPayload(BaseModel):
    location: str = Field(min_length=1, max_length=200)
    features: list[PlannerFeature] = Field(default_factory=list)


class PlannerMapResponse(PlannerMapPayload):
    updatedAt: str | None = None
