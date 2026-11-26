# syntax=docker/dockerfile:1
# Build a new image from the pinned official OpenBot 0.79.0 image. Author: TheWalkingGlitch.
# The build replaces app.asar in that new image. It does not change a running container.
FROM node:22-bookworm-slim AS patch
COPY patch-openbot-0.79.mjs /tmp/patch-openbot-0.79.mjs
COPY --from=ghcr.io/nightly-labs/openbot:0.79.0@sha256:136cd40211352af4ec41df4451a920aebc79c5bb3f94cb862f6a3aea4696e915 /opt/OpenBot/app/resources/app.asar /tmp/app.asar
RUN node /tmp/patch-openbot-0.79.mjs /tmp/app.asar

FROM ghcr.io/nightly-labs/openbot:0.79.0@sha256:136cd40211352af4ec41df4451a920aebc79c5bb3f94cb862f6a3aea4696e915
USER root
COPY --from=patch --chown=root:root /tmp/app.asar /opt/OpenBot/app/resources/app.asar
USER openbot
