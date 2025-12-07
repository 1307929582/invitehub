FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt requirements-celery.txt ./
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir -r requirements-celery.txt

COPY . .

RUN mkdir -p data

# 复制并设置启动脚本权限
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 18000

# 使用启动脚本
CMD ["/entrypoint.sh"]
