from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from planner_api.agent_ws import router as agent_ws_router
from planner_api.backboard import router as backboard_router
from planner_api.routes import router as planner_router
from planner_api.startup_docs import sync_assistant_startup_documents



@asynccontextmanager
async def lifespan(_app: FastAPI):
    await sync_assistant_startup_documents()
    yield


app = FastAPI(title="Urban Planner API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(planner_router)
app.include_router(agent_ws_router)
app.include_router(backboard_router)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
