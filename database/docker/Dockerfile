# syntax=docker/dockerfile:1

FROM postgres:17.11-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        pgtap=1.3.4-1.pgdg12+1 \
        postgresql-17-pgtap=1.3.4-1.pgdg12+1 \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /usr/local/bin/gosu

USER 999:999

EXPOSE 5432

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=12 \
  CMD ["pg_isready", "-U", "postgres", "-d", "meu_processo"]
