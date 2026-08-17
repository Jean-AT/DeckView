# ===== Build stage =====
FROM node:20-alpine AS build

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ===== Runtime stage =====
FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache openssl \
    && addgroup -S app \
    && adduser -S app -G app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev \
    && npx prisma generate \
    && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh

RUN chmod +x scripts/docker-entrypoint.sh \
    && chown -R app:app /app

USER app
EXPOSE 3000

ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]