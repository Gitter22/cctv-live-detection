# services/vision: Python detection service (CPU). Never touches the database.
FROM python:3.12-slim

# uv binary from Astral's official image (pinned).
COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /usr/local/bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_HTTP_TIMEOUT=180 \
    UV_PYTHON_DOWNLOADS=never UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends curl libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first (cached layer). --frozen: fail if uv.lock is out of date.
COPY services/vision/pyproject.toml services/vision/uv.lock services/vision/.python-version ./
# Wheels come from the host uv cache if provided (see UV_CACHE_HOST_DIR), else PyPI.
RUN --mount=type=bind,from=uvcache,target=/root/.cache/uv,rw \
    uv sync --frozen --no-dev --no-install-project

# Detector weights: D-FINE (Apache-2.0) ONNX export from Hugging Face onnx-community.
ARG DFINE_VARIANT=s
RUN mkdir -p /models && curl -fsSL --retry 5 -o /models/dfine.onnx \
    "https://huggingface.co/onnx-community/dfine_${DFINE_VARIANT}_coco-ONNX/resolve/main/onnx/model.onnx"

COPY services/vision/vision ./vision
COPY services/vision/tests ./tests
COPY services/vision/tools ./tools

CMD ["python", "-m", "vision"]
