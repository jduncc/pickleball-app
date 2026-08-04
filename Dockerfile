# ---- Stage 1: build the React client ----
FROM node:20-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client/ .
RUN npm run build

# ---- Stage 2: server runtime ----
FROM node:20-bookworm-slim AS server
# better-sqlite3 needs a compiler to build its native module
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/ .
COPY --from=client-build /app/client/dist ./public

ENV PORT=3000
ENV DATA_DIR=/app/data
EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "index.js"]
