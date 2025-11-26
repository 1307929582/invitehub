FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p data

# 创建启动脚本
RUN echo '#!/bin/bash\n\
# 执行数据库迁移\n\
alembic upgrade head\n\
# 启动应用\n\
exec uvicorn app.main:app --host 0.0.0.0 --port 4567 --workers 4\n\
' > /app/start.sh && chmod +x /app/start.sh

EXPOSE 4567

CMD ["/app/start.sh"]
