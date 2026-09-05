from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Sentinel Backend"
    api_prefix: str = "/api"
    database_url: str = "sqlite:///./sentinel.db"
    storage_dir: Path = Path("storage")
    cors_origins: str = "http://localhost:3000"
    seed_demo_data: bool = False
    auth_session_hours: int = Field(default=24, ge=1, le=168)
    bootstrap_admin_email: str | None = None
    bootstrap_admin_password: str | None = None
    sandbox_image: str = "sentinel-test-runner:local"
    sandbox_timeout_seconds: int = Field(default=30, ge=1, le=120)
    sandbox_memory: str = "256m"
    sandbox_cpus: float = Field(default=0.5, gt=0, le=4)
    ai_api_key: str = ""
    ai_base_url: str = "https://api.openai.com/v1"
    ai_model: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

