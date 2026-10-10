# Build the client, then ship a runtime with only the server's dependencies.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w client

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev -w server -w shared --no-audit --no-fund
COPY shared shared
COPY server server
COPY --from=build /app/client/dist client/dist
WORKDIR /app/server
# Uploaded images, documents and music. Mount a volume here — and back it up
# alongside Postgres; boards reference these files by hash.
VOLUME /app/server/data
EXPOSE 3001
# `node --import tsx` rather than `npx tsx`, so SIGTERM reaches the server
# itself and it can save open boards before exiting (see shutdown in index.ts).
CMD ["sh", "-c", "node --import tsx src/scripts/migrate.ts && exec node --import tsx src/index.ts"]
