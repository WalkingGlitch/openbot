# syntax=docker/dockerfile:1
# Build a new image from the pinned OpenBot 0.65.0 image.
# The build replaces app.asar in that new image. It does not change a running container.
FROM node:22-bookworm-slim AS patch
COPY patch-acp-turn-stall.mjs /tmp/patch-acp-turn-stall.mjs
COPY --from=ghcr.io/nightly-labs/openbot:0.65.0@sha256:805aa13d29ca2fe299e5fcd7f815d5f851bc5ea1efa7a6e9cb4e4b6db2029c21 /opt/OpenBot/app/resources/app.asar /tmp/app.asar
RUN node /tmp/patch-acp-turn-stall.mjs /tmp/app.asar

FROM ghcr.io/nightly-labs/openbot:0.65.0@sha256:805aa13d29ca2fe299e5fcd7f815d5f851bc5ea1efa7a6e9cb4e4b6db2029c21
USER root
COPY --from=patch --chown=root:root /tmp/app.asar /opt/OpenBot/app/resources/app.asar
USER openbot
