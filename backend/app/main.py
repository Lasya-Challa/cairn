from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import Base, engine
from .routers import admin, auth, clinical, referrals, sessions, students


def create_app() -> FastAPI:
    app = FastAPI(
        title="Cairn API",
        description="Student mental health case management: referrals, assessments, plans, sessions, billing.",
        version="0.1.0",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )
    for module in (auth, students, clinical, sessions, referrals, admin):
        app.include_router(module.router)

    @app.get("/api/health", tags=["meta"])
    def health():
        return {"status": "ok"}

    return app


Base.metadata.create_all(engine)
app = create_app()
