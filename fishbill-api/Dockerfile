FROM node:20-alpine

WORKDIR /app

# Install production dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy application source
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY migrations/ ./migrations/
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Create writable directories (will be overridden by volume mounts in production)
RUN mkdir -p \
      uploads/invoices \
      uploads/delivery-notes \
      pdfs \
      public/pdfs \
      public/avatars \
      public/apk \
      public/uploads/weighing-slips \
      public/uploads/ospa \
      backups \
      logs

# Run as non-root for security
RUN addgroup -S fishbill && adduser -S fishbill -G fishbill \
 && chown -R fishbill:fishbill /app
USER fishbill

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD wget -qO- http://localhost:4000/health || exit 1

ENTRYPOINT ["./entrypoint.sh"]
