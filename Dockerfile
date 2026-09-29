FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev \
  && groupadd --system roomflow \
  && useradd --system --gid roomflow --create-home roomflow \
  && mkdir /app/data \
  && chown -R roomflow:roomflow /app
COPY --from=build --chown=roomflow:roomflow /app/dist ./dist
USER roomflow
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/server.js"]
