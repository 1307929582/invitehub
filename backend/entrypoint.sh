#!/bin/sh
set -e

# 等待数据库就绪
echo "Waiting for database..."
sleep 2

# 修复迁移版本记录
echo "Fixing migration version records..."
python -c "
import os
from sqlalchemy import create_engine, text

database_url = os.environ.get('DATABASE_URL', 'sqlite:///./data/team_manager.db')
engine = create_engine(database_url)

try:
    with engine.connect() as conn:
        # 检查当前版本
        result = conn.execute(text('SELECT version_num FROM alembic_version'))
        rows = result.fetchall()
        
        if rows:
            current_version = rows[0][0]
            print(f'Current migration version: {current_version}')
            
            # 如果是旧的 gemini 版本，更新到新版本
            if 'gemini' in current_version.lower() or current_version == '003_add_gemini':
                conn.execute(text(\"UPDATE alembic_version SET version_num = '003_remove_gemini'\"))
                conn.commit()
                print('Updated migration version to 003_remove_gemini')
        else:
            print('No migration version found')
except Exception as e:
    print(f'Migration fix skipped: {e}')
"

# 运行数据库迁移
echo "Running database migrations..."
alembic upgrade head

# 启动应用
echo "Starting application..."
exec uvicorn app.main:app --host 0.0.0.0 --port 4567 --workers 4
