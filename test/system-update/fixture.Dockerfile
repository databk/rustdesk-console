# This derivative is an unpublished local integration fixture, never a release.
ARG BASE_IMAGE=console-system-update-test-backend:local
FROM ${BASE_IMAGE}
ARG FIXTURE_VERSION
ENV APP_VERSION=${FIXTURE_VERSION}
COPY artifacts/fixture-entrypoint.cjs /app/dist/updater/entrypoint.js
RUN node -e "const fs=require('fs');const p='/app/release-metadata.json';const m=JSON.parse(fs.readFileSync(p));m.version=process.env.APP_VERSION;fs.writeFileSync(p,JSON.stringify(m))"
LABEL console-system-update-test=true \
      org.opencontainers.image.version=${FIXTURE_VERSION}
