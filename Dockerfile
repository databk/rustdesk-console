# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:24-alpine AS production

WORKDIR /app

# The same immutable image runs the API, updater and independent job worker.
# No tools are downloaded while an update is in progress.
RUN apk add --no-cache docker-cli docker-cli-compose sqlite mariadb-client \
    mariadb-connector-c util-linux ca-certificates tar su-exec

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --omit=dev

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY deployment ./deployment
COPY deployment/docker-entrypoint.sh /usr/local/bin/console-entrypoint
RUN chmod 755 /usr/local/bin/console-entrypoint

# Expose the application port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

# Inject application version from package.json at build time
ARG APP_VERSION=unknown
ENV APP_VERSION=${APP_VERSION}
ARG SOURCE_COMMIT=unknown
ENV SOURCE_COMMIT=${SOURCE_COMMIT}
RUN node -e "require('fs').writeFileSync('/app/release-metadata.json', JSON.stringify({version:process.env.APP_VERSION,sourceCommit:process.env.SOURCE_COMMIT}))"
LABEL org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.revision=${SOURCE_COMMIT} \
      org.opencontainers.image.source="https://github.com/databk/rustdesk-console"

# Create data directory for database and build artifact persistence
RUN mkdir -p /data

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/login-options', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
ENTRYPOINT ["console-entrypoint"]
CMD ["node", "dist/main.js"]
