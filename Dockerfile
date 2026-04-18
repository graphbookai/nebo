ARG PYTHON_VERSION=3.12
ARG NODE_VERSION=22
ARG NEBO_VERSION=0.0.0+docker


FROM node:${NODE_VERSION}-slim AS ui-builder

WORKDIR /ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci

COPY ui/ ./
RUN npm run build


FROM python:${PYTHON_VERSION}-slim AS builder
ARG NEBO_VERSION

ENV SETUPTOOLS_SCM_PRETEND_VERSION=${NEBO_VERSION}

WORKDIR /src
COPY pyproject.toml README.md ./
COPY nebo ./nebo

RUN rm -rf nebo/server/static
COPY --from=ui-builder /ui/dist ./nebo/server/static

RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir --prefix=/install .


FROM python:${PYTHON_VERSION}-slim AS runtime

COPY --from=builder /install /usr/local

RUN groupadd --gid 1000 nebo \
 && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash nebo \
 && mkdir -p /data \
 && chown -R nebo:nebo /data

USER nebo
WORKDIR /data

ENV NEBO_DAEMON_PORT=2048 \
    PYTHONUNBUFFERED=1

EXPOSE 2048

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://localhost:2048/health', timeout=2).status == 200 else 1)" || exit 1

CMD ["uvicorn", "nebo.server.daemon:create_daemon_app", \
     "--factory", \
     "--host", "0.0.0.0", \
     "--port", "2048", \
     "--log-level", "warning"]
