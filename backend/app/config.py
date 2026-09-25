from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="CAIRN_", extra="ignore")

    database_url: str = "sqlite:///./cairn.db"
    secret_key: str = "dev-only-secret-change-me-before-deploying-anywhere"
    token_ttl_minutes: int = 480
    # District wall-clock time zone. Timestamps are stored as naive UTC.
    district_timezone: str = "America/Chicago"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
