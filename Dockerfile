# ─── HyperClaw Gateway — Docker Image ────────────────────────────────────────
# Build:   docker build -t hyperclaw .
# Run:     docker run -p 18789:18789 -v ~/.hyperclaw:/root/.hyperclaw hyperclaw

FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install
COPY tsconfig.json ./
COPY src ./src
COPY static ./static
RUN npm run build:tsc 2>/dev/null || npm run build

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.title="HyperClaw"
LABEL org.opencontainers.image.description="⚡ AI Gateway Platform — The Lobster Evolution"
LABEL org.opencontainers.image.version="4.0.0"
LABEL org.opencontainers.image.licenses="MIT"

# Create non-root user
RUN addgroup -S hyperclaw && adduser -S hyperclaw -G hyperclaw

WORKDIR /app

# Copy built artifacts and runtime deps only
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Data directory
RUN mkdir -p /data/hyperclaw/logs /data/hyperclaw/credentials && \
    chmod 700 /data/hyperclaw /data/hyperclaw/credentials && \
    chown -R hyperclaw:hyperclaw /data

USER hyperclaw

# Gateway config via environment
ENV HYPERCLAW_PORT=18789
ENV HYPERCLAW_BIND=0.0.0.0
ENV HYPERCLAW_DIR=/data/hyperclaw
ENV NODE_ENV=production

EXPOSE 18789

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:18789/api/status | grep '"running":true' || exit 1

ENTRYPOINT ["node", "dist/run-main.js"]
CMD ["gateway:serve"]
