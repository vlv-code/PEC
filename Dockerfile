# ==============================================================================
# PEC - Proxy Extension Corp
# Production Multi-Stage Dockerfile
# ==============================================================================

FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules if required
RUN apk add --no-cache python3 make g++ git

# Copy dependency manifests
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy application source code
COPY . .

# Build application bundle / static assets
RUN npm run build

# ==============================================================================
# Production Runner
# ==============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

# Install tzdata and dumb-init for proper signal handling
RUN apk add --no-cache tzdata dumb-init curl bash

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Create application directories with non-root ownership
RUN addgroup -g 1001 -S pecgroup && \
    adduser -u 1001 -S pecuser -G pecgroup

# Copy dependencies and built files
COPY --from=builder --chown=pecuser:pecgroup /app/node_modules ./node_modules
COPY --from=builder --chown=pecuser:pecgroup /app/package.json ./package.json
COPY --from=builder --chown=pecuser:pecgroup /app/dist ./dist
COPY --from=builder --chown=pecuser:pecgroup /app/server.ts ./server.ts
COPY --from=builder --chown=pecuser:pecgroup /app/src ./src
COPY --from=builder --chown=pecuser:pecgroup /app/metadata.json ./metadata.json
COPY --from=builder --chown=pecuser:pecgroup /app/extension_build_config.json ./extension_build_config.json
COPY --from=builder --chown=pecuser:pecgroup /app/deploy ./deploy

# Ensure writable directories for credentials, logs, and extension artifacts
RUN mkdir -p /app/extension /app/dist/updates /app/data && \
    chown -R pecuser:pecgroup /app

USER pecuser

EXPOSE 3000

# Health check probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/healthz || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["npm", "start"]
