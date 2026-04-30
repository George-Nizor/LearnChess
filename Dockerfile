# syntax=docker/dockerfile:1.7
#
# LearnChess Docker image — three-stage build.
#
# Stage 1 (builder): Node 22 alpine. Installs deps, vendors the
#   Stockfish engine and Lichess puzzle DB, then runs the production
#   Vite build. Outputs ~150 MB of static assets to /app/dist.
#
# Stage 2 (compressor): Alpine + brotli + gzip. Pre-compresses every
#   text-like asset so nginx can serve `gzip_static on` / `brotli_static
#   on` without spending CPU on every request. Brotli at quality 6 hits
#   roughly 70-80% of the size win at maybe 4x the compression cost
#   (vs quality 11), but since this only runs once per build it's a
#   non-issue.
#
# Stage 3 (runtime): `fholzer/nginx-brotli` — a minimal Alpine nginx
#   with the brotli module baked in. ~15 MB image, well-maintained.
#   The unprivileged variant runs as nginx user on port 8080 so this
#   image plays nicely behind any reverse proxy without root caps.
#
# Build-time NETWORK requirement:
#   - vendor:engine pulls Stockfish 16 WASM files from GitHub
#   - build:puzzles downloads ~280 MB Lichess puzzle CSV
#   - npm registry for deps
# Run-time network is OPTIONAL — only needed for Lichess tablebase
# (the Endgames pillar) and the opt-in Lichess study import. Everything
# else is offline-capable after the first asset load.
#
# Build:    docker build -t learnchess .
# Run:      docker run -p 8080:8080 learnchess
# Compose:  docker compose up -d

# ──────────────────────────────────────────────────────────────────
# Stage 1 — builder
# ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package manifests first so the install layer caches between
# code-only edits. node_modules is not part of the runtime image,
# so size doesn't matter here.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --prefer-offline

# Copy the rest of the source. .dockerignore excludes node_modules
# and dist so this is just source + scripts + public.
COPY . .

# Vendor the Stockfish engine (~85 MB) and build the puzzle DB
# (~55 MB) into public/. These are NOT committed to git so they
# must be re-fetched per build.
#
# vendor:engine is fast (~20 sec). build:puzzles is slow (~60 sec
# of CPU + 280 MB download). If iterating on the image during dev,
# Docker layer caching keeps both unless package.json or scripts/
# change.
#
# NODE_OPTIONS bumps the heap to 4 GB for build:puzzles — fzstd is
# pure-JS and decompresses the 280 MB zstd dump into a single in-memory
# buffer (~1.5 GB uncompressed CSV) before parsing. The default ~2 GB
# heap is right at the edge, so we lift it to avoid intermittent OOMs
# on memory-constrained CI runners and home-lab Docker hosts.
RUN npm run vendor:engine

# BuildKit cache mount keeps the 280 MB Lichess puzzle CSV across
# rebuilds — `.cache/lichess_db_puzzle.csv.zst` survives between
# `docker build` invocations so monthly refreshes skip the re-download.
# build-puzzles.ts honours the existing-file check, so the cache hit
# is automatic. Wipe with `docker builder prune` when you actually
# want a fresh dump (Lichess refreshes the dataset monthly).
RUN --mount=type=cache,target=/app/.cache \
    NODE_OPTIONS="--max-old-space-size=4096" npm run build:puzzles

# Production Vite build into /app/dist
RUN npm run build

# ──────────────────────────────────────────────────────────────────
# Stage 2 — pre-compress
# ──────────────────────────────────────────────────────────────────
# Brotli + gzip every text-like asset so nginx serves the .br/.gz
# variants without runtime CPU.
FROM alpine:3.20 AS compressor

RUN apk add --no-cache brotli gzip findutils

COPY --from=builder /app/dist /dist

# Compress every text/asset file. Skip already-compressed files
# (.br/.gz) and binary formats that don't benefit (sound files,
# the .nnue engine weights — already weight-quantized).
RUN find /dist -type f \
      \( -name '*.js'   -o -name '*.css'  -o -name '*.json' \
      -o -name '*.html' -o -name '*.svg'  -o -name '*.wasm' \
      -o -name '*.db'   -o -name '*.txt'  -o -name '*.map' \
      \) ! -name '*.br' ! -name '*.gz' \
    | while IFS= read -r f; do \
        brotli --quality=6 --keep --no-copy-stat -- "$f"; \
        gzip --keep --best --no-name -- "$f"; \
      done

# ──────────────────────────────────────────────────────────────────
# Stage 3 — runtime (Alpine nginx with brotli)
# ──────────────────────────────────────────────────────────────────
# fholzer/nginx-brotli ships brotli_static + brotli on dynamic
# compression. ~15 MB image. Runs as `nginx` user on port 8080 by
# default (no privileged ports needed).
FROM fholzer/nginx-brotli:v1.30.0

# Drop to non-root user. The base image's default config writes pid
# and access logs to locations the nginx user can write; we keep
# that behaviour.
USER nginx

# Static assets served from /usr/share/nginx/html
COPY --from=compressor --chown=nginx:nginx /dist /usr/share/nginx/html

# Our vhost config goes in conf.d (the default include path).
COPY --chown=nginx:nginx deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

# Healthcheck: the SPA shell should always 200.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

# fholzer/nginx-brotli's default CMD already runs nginx in foreground.
