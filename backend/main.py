"""Xiangqi-Claw backend entry point."""

from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.engine.manager import ENGINE_NAME, engine, get_engine
from backend.routers import analysis, game, puzzle, review
from backend.services.puzzle import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    eng = await get_engine()
    yield
    await eng.stop()


app = FastAPI(title="Xiangqi-Claw API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(game.router)
app.include_router(analysis.router)
app.include_router(puzzle.router)
app.include_router(review.router)


@app.get("/api/health")
async def health():
    return {"status": "ok", "engine": ENGINE_NAME}
