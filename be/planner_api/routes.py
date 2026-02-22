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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid planner map data") from exc


@router.put("/map", response_model=PlannerMapResponse)
def put_map(payload: PlannerMapPayload) -> PlannerMapResponse:
    try:
        return storage.write(payload)
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Failed to save map") from exc
