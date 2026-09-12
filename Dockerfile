# ============================================================
#  Docker image - Select Mobility TMS
#
#  Works on any container host that gives you a free tier, including
#  Fly.io, Koyeb and Northflank. Also useful for running the system on
#  your own server with a repeatable, isolated environment.
#
#  Build:  docker build -t select-mobility-tms .
#  Run:    docker run -d -p 4000:4000 \
#            -v tms-data:/app/server/data \
#            -e ADMIN_PASSWORD=ChangeMe123 \
#            --name tms select-mobility-tms
#
#  The -v volume keeps your data on the host, so rebuilding the image does
#  not lose records. On hosts without volumes, set BACKUP_S3_* instead.
# ============================================================

FROM node:22-alpine

# Run as a non-root user.
RUN addgroup -S tms && adduser -S tms -G tms

WORKDIR /app

# Install dependencies first so this layer caches between code changes.
COPY package.json package-lock.json ./
RUN npm install --omit=dev && npm cache clean --force

# Application source.
COPY server/ ./server/
COPY client/ ./client/
COPY docs/   ./docs/
COPY tools/  ./tools/
COPY README.md .env.example ./

# Data directory, owned by the runtime user.
RUN mkdir -p /app/server/data && chown -R tms:tms /app

USER tms

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0
ENV DATABASE_FILE=server/data/tms.db

EXPOSE 4000

# Health check so the platform can restart a wedged container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
