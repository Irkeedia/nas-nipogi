import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    APP_NAME: str = "NexusNAS"
    SECRET_KEY: str = "nexusnas-super-secret-key-change-me-in-production-2026"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24h
    STORAGE_PATH: str = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "storage")
    THUMBNAILS_PATH: str = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "thumbnails")
    DATABASE_URL: str = "sqlite+aiosqlite:///./nexusnas.db"
    MAX_UPLOAD_SIZE: int = 10 * 1024 * 1024 * 1024  # 10 GB
    HOST: str = "0.0.0.0"
    PORT: int = 8888

settings = Settings()

# Ensure directories exist
os.makedirs(settings.STORAGE_PATH, exist_ok=True)
os.makedirs(settings.THUMBNAILS_PATH, exist_ok=True)
