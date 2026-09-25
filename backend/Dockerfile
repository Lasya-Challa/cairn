FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
# Seed on first start only when the database is empty, then serve.
CMD ["sh", "-c", "python -c 'from app.db import engine; from sqlalchemy import inspect; import sys; sys.exit(0 if inspect(engine).has_table(\"users\") else 1)' || python -m seed; uvicorn app.main:app --host 0.0.0.0 --port 8000"]
