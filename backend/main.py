from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import CORS_ORIGINS
from database import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Colorful·Meridian API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from routers.auth import router as auth_router
from routers.places import router as places_router
from routers.photos import router as photos_router
from routers.meta import router as meta_router

app.include_router(auth_router)
app.include_router(places_router)
app.include_router(photos_router)
app.include_router(meta_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
