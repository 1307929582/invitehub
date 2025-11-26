# 系统配置管理 API
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import SystemConfig, User
from app.services.auth import get_current_user

router = APIRouter(prefix="/config", tags=["config"])


class ConfigItem(BaseModel):
    key: str
    value: Optional[str]
    description: Optional[str]


class ConfigResponse(BaseModel):
    key: str
    value: Optional[str]
    description: Optional[str]
    updated_at: datetime

    class Config:
        from_attributes = True


class ConfigListResponse(BaseModel):
    configs: List[ConfigResponse]


# 默认配置项
DEFAULT_CONFIGS = [
    {"key": "linuxdo_client_id", "description": "LinuxDO OAuth Client ID"},
    {"key": "linuxdo_client_secret", "description": "LinuxDO OAuth Client Secret"},
    {"key": "linuxdo_redirect_uri", "description": "LinuxDO OAuth 回调地址"},
    {"key": "site_title", "description": "站点标题"},
    {"key": "site_description", "description": "站点描述"},
    {"key": "min_trust_level", "description": "最低信任等级要求（0-4）"},
]


@router.get("", response_model=ConfigListResponse)
async def list_configs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取所有配置"""
    configs = db.query(SystemConfig).all()
    
    # 确保默认配置项存在
    existing_keys = {c.key for c in configs}
    for default in DEFAULT_CONFIGS:
        if default["key"] not in existing_keys:
            new_config = SystemConfig(
                key=default["key"],
                value="",
                description=default["description"]
            )
            db.add(new_config)
    db.commit()
    
    configs = db.query(SystemConfig).all()
    return ConfigListResponse(configs=[
        ConfigResponse(
            key=c.key,
            value=c.value if "secret" not in c.key.lower() else ("*" * 8 if c.value else ""),
            description=c.description,
            updated_at=c.updated_at
        ) for c in configs
    ])


@router.put("/{key}")
async def update_config(
    key: str,
    data: ConfigItem,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """更新配置"""
    config = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    
    if config:
        # 如果是 secret 且值为 ****，不更新
        if "secret" in key.lower() and data.value and data.value.startswith("*"):
            pass
        else:
            config.value = data.value
        if data.description:
            config.description = data.description
    else:
        config = SystemConfig(
            key=key,
            value=data.value,
            description=data.description
        )
        db.add(config)
    
    db.commit()
    return {"message": "配置已更新", "key": key}


@router.post("/batch")
async def batch_update_configs(
    configs: List[ConfigItem],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """批量更新配置"""
    for item in configs:
        config = db.query(SystemConfig).filter(SystemConfig.key == item.key).first()
        
        if config:
            if "secret" in item.key.lower() and item.value and item.value.startswith("*"):
                continue
            config.value = item.value
            if item.description:
                config.description = item.description
        else:
            config = SystemConfig(
                key=item.key,
                value=item.value,
                description=item.description
            )
            db.add(config)
    
    db.commit()
    return {"message": f"已更新 {len(configs)} 项配置"}
