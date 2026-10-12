FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache iproute2
COPY agent/*.mjs agent/schema.json ./agent/
COPY network/tcp-observation.js ./network/
USER root
EXPOSE 3001
CMD ["node", "agent/index.mjs"]
