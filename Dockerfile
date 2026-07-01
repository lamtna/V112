FROM node:20-alpine AS base
WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Dependencies layer (cached separately)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# Source
COPY src ./src
COPY scripts ./scripts

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 4000
CMD ["node","src/index.js"]
