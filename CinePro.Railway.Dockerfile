# CinePro Core — Railway build from monorepo root
FROM node:22-alpine AS builder

WORKDIR /app

COPY cinepro-core/package*.json ./
RUN npm ci

COPY cinepro-core/ ./
RUN npm run build

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

COPY cinepro-core/package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

USER nodejs

EXPOSE 3000

CMD ["node", "dist/server.js"]
