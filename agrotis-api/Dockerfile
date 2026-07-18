FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

ENV NODE_ENV=production
ENV PORT=4001

EXPOSE 4001

# Run migrations then start the server
CMD ["sh", "-c", "node scripts/run-migrations.js && node src/server.js"]
