# 配置管理
import os
from typing import Optional
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """应用配置"""
    
    # 应用配置
    APP_NAME: str = "ChatGPT Team Manager"
    APP_VERSION: str = "1.4.0"
    DEBUG: bool = False

    # Redis 兑换码令牌桶（旧限流机制，默认关闭）
    REDEEM_REDIS_LIMITER_ENABLED: bool = False
    
    # GitHub 仓库（用于版本检查）
    GITHUB_REPO: str = "1307929582/team-invite"
    
    # API 配置
    API_PREFIX: str = "/api/v1"
    
    # ChatGPT API
    CHATGPT_API_BASE: str = "https://chat.openai.com/backend-api"
    
    # 数据库配置
    # 支持 SQLite 和 PostgreSQL
    # SQLite: sqlite:///./data/app.db
    # PostgreSQL: postgresql://user:password@localhost:5432/dbname
    DATABASE_URL: str = "sqlite:///./data/app.db"
    
    # JWT 配置
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    # Rate Limit
    INVITE_DELAY_SECONDS: float = 1.0
    MAX_BATCH_SIZE: int = 100

    # Proxy / client IP handling for rate limiting
    # Only enable when running behind a trusted reverse proxy that sets these headers.
    TRUST_PROXY_HEADERS: bool = False
    # Comma-separated CIDRs or IPs of trusted proxies, e.g. "127.0.0.1,10.0.0.0/8"
    TRUSTED_PROXY_IPS: str = ""

    # CORS
    CORS_ORIGINS: list = ["http://localhost:3000", "http://localhost:5173"]
    
    # LinuxDO OAuth 配置
    LINUXDO_CLIENT_ID: str = ""
    LINUXDO_CLIENT_SECRET: str = ""
    LINUXDO_REDIRECT_URI: str = "http://localhost:5173/auth/callback"
    LINUXDO_AUTH_URL: str = "https://connect.linux.do/oauth2/authorize"
    LINUXDO_TOKEN_URL: str = "https://connect.linux.do/oauth2/token"
    LINUXDO_USER_URL: str = "https://connect.linux.do/api/user"
    
    @property
    def is_sqlite(self) -> bool:
        """判断是否使用 SQLite"""
        return self.DATABASE_URL.startswith("sqlite")
    
    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
