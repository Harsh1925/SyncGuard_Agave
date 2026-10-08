FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml ./
COPY requirements.lock ./
COPY src ./src
COPY simulators ./simulators
COPY migrations ./migrations
RUN pip install --no-cache-dir -c requirements.lock . && useradd --create-home syncguard && mkdir /data && chown syncguard /data
USER syncguard
CMD ["uvicorn", "syncguard.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
