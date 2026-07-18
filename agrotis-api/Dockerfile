FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

RUN chmod +x entrypoint.sh

ENV NODE_ENV=production
ENV PORT=4001

EXPOSE 4001

CMD ["./entrypoint.sh"]
