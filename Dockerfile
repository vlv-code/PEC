# ==============================================================================
# PEC - Proxy Extension Corp
# Production Multi-Stage Dockerfile
# ==============================================================================

FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules if required
RUN apk add --no-cache python3 make g++ git

# Copy dependency manifests (package-lock.json is committed - npm ci works)
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy application source code
COPY . .

# Build application bundle / static assets
RUN npm run build

# ==============================================================================
# Production Runner (runtime dependencies only, no sources, no devDependencies)
# ==============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install tzdata and dumb-init for proper signal handling
RUN apk add --no-cache tzdata dumb-init curl bash

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data

# Create application directories with non-root ownership
RUN addgroup -g 1001 -S pecgroup && \
    adduser -u 1001 -S pecuser -G pecgroup

# Runtime dependencies only: the bundle (dist/server.cjs) externalizes packages
COPY --from=builder --chown=pecuser:pecgroup /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built bundle only - server.ts/src are not needed at runtime
COPY --from=builder --chown=pecuser:pecgroup /app/dist ./dist

# Dashboard static assets served by express.static (see server.ts)
COPY --from=builder --chown=pecuser:pecgroup /app/public ./public

# Writable directories for credentials, runtime state and extension artifacts.
# Mount /app/data as a volume: every persistent store lives there (see
# docker-compose.yml environment) and survives rebuilds and redeploys.
RUN mkdir -p /app/data /app/extension /app/dist/updates && \
    chown -R pecuser:pecgroup /app

VOLUME ["/app/data"]

USER pecuser

EXPOSE 3000

# Health check probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/healthz || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server.cjs"]
