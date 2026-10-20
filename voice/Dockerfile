FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project
COPY agent.py booking.py outbound.py engine_client.py input_gate.py knowledge.md ./
ENV HOST=0.0.0.0 PYTHONUNBUFFERED=1
RUN uv run python agent.py download-files || true
CMD ["uv","run","--frozen","python","agent.py","start"]
