# syntax=docker/dockerfile:1
#
# Tallyhand production image (hosted mode).
# Built from the repo root:  docker build -f deploy/Dockerfile .
# The entrypoint waits for Postgres, applies drizzle/*.sql migrations,
# then starts Next.js. Runs as a non-root user.

FROM node:22-alpine AS builder
WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json* ./
RUN npm ci

# Build the app (needs devDependencies: typescript, etc.).
COPY . .
RUN npm run build

# --- production deps only ---------------------------------------------
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# --- runtime -----------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Local-disk attachment fallback persists here (mounted as a volume).
ENV TALLYHAND_ATTACHMENTS_DIR=/data/attachments

RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /data/attachments .next \
  && chown -R app:app /app /data/attachments

COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./package.json
COPY --from=builder --chown=app:app /app/next.config.mjs ./next.config.mjs
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder --chown=app:app /app/drizzle ./drizzle
COPY --chown=app:app deploy/entrypoint.sh deploy/migrate.mjs ./deploy/

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["./deploy/entrypoint.sh"]
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
