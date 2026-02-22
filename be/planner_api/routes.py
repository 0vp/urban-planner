from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from planner_api.models import PlannerMapPayload, PlannerMapResponse
from planner_api.storage import PlannerStorage


router = APIRouter(prefix="/api/planner", tags=["planner"])
storage = PlannerStorage(Path(__file__).resolve().parent.parent / "data" / "planner")


@router.get("/map", response_model=PlannerMapResponse)
def get_map(location: str = Query(..., min_length=1, max_length=200)) -> PlannerMapResponse:
    try:
        return storage.read(location)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load map: {exc}") from exc


@router.put("/map", response_model=PlannerMapResponse)
def put_map(payload: PlannerMapPayload) -> PlannerMapResponse:
    try:
        return storage.write(payload)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save map: {exc}") from exc
