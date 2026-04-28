# Deploy — home-lab self-hosting

> Status: **preparation, not yet wired up.** Templates and notes below are
> ready to drop into a real deployment but no `docker-compose.yml`,
> `Dockerfile`, or CI workflow has been added to the repo yet. Last
> verified production build: 2026-04-28 (commit `86514e6`).

## What you're shipping

LearnChess is a **fully static SPA** — no backend, no database server, no
session cookies. Everything per-user lives in the browser's IndexedDB.
That means deployment is "serve a directory of files over HTTPS"; any
static-file server with the right cache headers and HTTPS will do.

### Build artefacts

```
$ npm run build
$ du -sh dist/
148M  dist/
```

| Path                        | Size   | Notes                                              |
|-----------------------------|--------|----------------------------------------------------|
| `dist/index.html`           | 4 KB   | No-cache; entrypoint                                |
| `dist/assets/*.js`          | 1.1 MB | Content-hashed, immutable cache (1 year)           |
| `dist/assets/*.css`         | 55 KB  | Content-hashed, immutable cache                    |
| `dist/assets/sqlite3-*.wasm`| 850 KB | Content-hashed; Brotli to ~390 KB                  |
| `dist/engine/*.wasm`        | 564 KB | Stockfish core; vendored, NOT content-hashed       |
| `dist/engine/*.nnue`        | 85 MB  | NNUE weights (two .nnue files); compresses poorly  |
| `dist/puzzles.db`           | 55 MB  | SQLite blob; compresses to ~12 MB Brotli           |
| `dist/opening-names.json`   | 692 KB | Compresses to ~120 KB Brotli                       |
| `dist/sounds/*`             | 228 KB | Static, immutable                                  |
| `dist/board-themes/`        | 24 KB  | Vendored chessground CSS palettes                  |
| `dist/piece-sets/`          | 288 KB | SVG sprite sets                                    |

**Cold first-load** is ~50 MB on the wire after Brotli (engine + puzzles
dominate). **Warm visits** are ~50 KB (HTML + cached everything else).
The .nnue engine weights cache aggressively after the first visit.

## Critical requirements

### HTTPS is non-negotiable

- IndexedDB needs a "secure context" — `localhost` works without HTTPS,
  any other hostname (including LAN IPs like `192.168.1.x` or hostnames
  like `chess.home.lan`) does NOT.
- WebAudio (move sounds) needs secure context.
- Stockfish wasm + sqlite-wasm both work over plain HTTP but the IDB
  failure means no progress persistence — you'd have a stateless app.

For home-lab this means either Caddy with a public domain (auto Let's
Encrypt) OR a self-signed cert via mkcert / step-ca on the LAN. There
is no plain-HTTP path that gives a working app.

### Stockfish is single-threaded — no COOP/COEP needed

We deliberately ship `stockfish-nnue-16-single` (single-thread, ~85 MB
NNUE) instead of the multi-threaded build. The deliberate trade-off:

- ✓ No `Cross-Origin-Opener-Policy: same-origin` header needed
- ✓ No `Cross-Origin-Embedder-Policy: require-corp` header needed
- ✓ Works behind any reverse proxy with default settings
- ✗ ~3000 Elo cap (multi-thread builds reach 3500+)

If you ever want multi-thread later, you'll need both COOP/COEP set on
the SPA AND every embedded resource (fonts CDN especially) to support
CORP. Don't do this lightly.

### Cache headers

Vite content-hashes everything in `dist/assets/`. Hashed assets are safe
to cache forever; unhashed ones (`index.html`, `engine/`, `puzzles.db`,
`opening-names.json`) need shorter TTLs.

| Path glob              | Cache-Control                            |
|------------------------|------------------------------------------|
| `/index.html`          | `no-cache, must-revalidate`              |
| `/assets/**`           | `public, max-age=31536000, immutable`    |
| `/engine/**.wasm`      | `public, max-age=2592000` (30 days)      |
| `/engine/**.nnue`      | `public, max-age=2592000`                |
| `/engine/*.json`       | `public, max-age=86400` (1 day; manifest)|
| `/puzzles.db`          | `public, max-age=2592000`                |
| `/sqlite/*.wasm`       | `public, max-age=2592000`                |
| `/board-themes/**`     | `public, max-age=2592000`                |
| `/piece-sets/**`       | `public, max-age=2592000`                |
| `/sounds/**`           | `public, max-age=2592000`                |
| `/opening-names.json`  | `public, max-age=2592000`                |
| `/favicon.svg`         | `public, max-age=86400`                  |

### Compression

Brotli level 6+ for text-like assets buys 3-5x size reduction. Pre-compress
at build time (saves CPU per request) — Caddy and nginx both serve `.br`
files automatically when present. Worth it for:

- `*.js`, `*.css`, `*.json` (always)
- `*.wasm` (~50% reduction for sqlite + stockfish core)
- `*.db` (puzzles.db Brotli compresses to ~12 MB from 55 MB)

The `.nnue` files are already weight-quantised and compress ~5% — not
worth pre-compressing.

### Outbound network deps (the one gotcha)

Two runtime fetches go to external hosts:

1. **`https://tablebase.lichess.ovh/standard?fen=...`** — Endgames pillar
   uses this for ground-truth WDL/DTZ grading. Without internet the
   Endgames trainer falls back to "tablebase unavailable" and uses
   Stockfish for evaluation only.
2. **`https://lichess.org/api/study/{id}.pgn`** — Only when the user
   explicitly clicks "Import Lichess study" in the Openings page. Opt-in.

**Fully air-gapped deploy:** both still degrade gracefully — the app
keeps working, just with reduced Endgames feedback. No outbound data
ever leaves the browser otherwise.

There's also a `<link rel="stylesheet">` to Google Fonts in `index.html`
for Bricolage Grotesque + Inter. With `display=swap` the system fallback
shows immediately, so air-gapped deploys look slightly different but
remain readable. Vendoring the fonts locally is a 5-minute job if you
want first-paint pixel-perfect offline.

## Deployment options

### Option A — Caddy (recommended for home-lab)

The simplest path. Caddy auto-provisions Let's Encrypt certs and handles
HTTPS without you ever touching `acme.sh` or `certbot`.

`Caddyfile`:

```caddy
chess.home.example.com {
    root * /srv/learnchess
    encode br gzip

    # Don't cache the SPA shell
    @html path /index.html /
    header @html Cache-Control "no-cache, must-revalidate"

    # Hashed assets: cache forever
    @hashed path /assets/*
    header @hashed Cache-Control "public, max-age=31536000, immutable"

    # Big static assets: 30 days
    @bigstatic {
        path *.wasm *.nnue *.db
        path /board-themes/* /piece-sets/* /sounds/*
    }
    header @bigstatic Cache-Control "public, max-age=2592000"

    # Engine manifest: 1 day
    header /engine/*.json Cache-Control "public, max-age=86400"

    # SPA fallback: any unmatched route → index.html
    try_files {path} /index.html
    file_server
}
```

Deploy:
```bash
npm run build
rsync -avz --delete dist/ user@homelab:/srv/learnchess/
ssh user@homelab "sudo systemctl reload caddy"
```

For LAN-only (no public DNS), use Caddy's `tls internal` directive with
mkcert-installed root CAs on each client. See Caddy docs.

### Option B — nginx + Let's Encrypt

Heavier setup, more knobs. Useful if you already run nginx for other
services on the same box.

`/etc/nginx/sites-available/learnchess.conf`:

```nginx
server {
    listen 443 ssl http2;
    server_name chess.home.example.com;

    ssl_certificate     /etc/letsencrypt/live/chess.home.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chess.home.example.com/privkey.pem;

    root /srv/learnchess;

    # Brotli requires the ngx_brotli module; gzip is built in.
    brotli on;
    brotli_static on;
    brotli_types application/javascript application/wasm application/json
                  application/octet-stream text/css image/svg+xml;
    gzip on;
    gzip_static on;
    gzip_types application/javascript application/wasm application/json
               application/octet-stream text/css image/svg+xml;

    # SPA shell: no cache
    location = /index.html {
        add_header Cache-Control "no-cache, must-revalidate";
    }
    location = / {
        add_header Cache-Control "no-cache, must-revalidate";
    }

    # Hashed assets: immutable cache
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # Big static assets
    location ~* \.(wasm|nnue|db)$ {
        add_header Cache-Control "public, max-age=2592000";
        try_files $uri =404;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 80;
    server_name chess.home.example.com;
    return 301 https://$host$request_uri;
}
```

### Option C — Docker / Compose

Multi-stage Dockerfile, ~150 MB final image. Good for keeping the deploy
self-contained on a homelab Kubernetes cluster or Docker Swarm.

`Dockerfile` (drop into repo root when ready):

```dockerfile
# ── build stage ──────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Engine + puzzles must be vendored before build. Either commit
# them into the repo image OR fetch them here:
RUN npm run vendor:engine \
 && npm run build:puzzles \
 && npm run build

# ── pre-compress static assets ───────────────────────────────
FROM alpine:3 AS compress
RUN apk add --no-cache brotli gzip findutils
WORKDIR /dist
COPY --from=build /app/dist /dist
RUN find /dist -type f \
        \( -name '*.js' -o -name '*.css' -o -name '*.json' \
           -o -name '*.wasm' -o -name '*.svg' -o -name '*.db' \
           -o -name '*.html' \) \
        ! -name '*.br' ! -name '*.gz' \
    | xargs -I{} sh -c 'brotli -q 6 -k "{}" && gzip -k -9 "{}"'

# ── runtime: nginx with brotli module ────────────────────────
FROM ghcr.io/nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=compress /dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
```

`docker-compose.yml`:

```yaml
services:
  learnchess:
    build: .
    image: learnchess:latest
    restart: unless-stopped
    ports:
      - "8080:8080"
    # If you have Caddy / Traefik / HAProxy in front, drop the port
    # binding and put this on the proxy network instead.
```

Build + run:
```bash
docker compose build
docker compose up -d
# Then point Caddy / nginx at http://localhost:8080
```

## Persistence model — what to back up (nothing on the server)

There's no server-side state. Each browser holds:

- **IndexedDB** databases:
  - `learnchess-openings` — repertoires, drilled moves, SRS state
  - `learnchess-puzzles` — puzzle attempts, SR cards, user rating
  - `learnchess-endgames` — position attempts, lesson progress
  - `learnchess-prefs` — board theme / piece set / sound pack
- **localStorage**: `learnchess.theme` (light/dark/auto)

If a user wants to migrate between browsers/devices, they'd need a
manual IDB export — not yet implemented; flag for a future feature
(see `docs/RESUME.md` for active priorities).

## Pre-deploy verification checklist

Before pushing to home-lab:

- [ ] `npm run build` completes without warnings beyond the chunk-size
      one (which is expected — the index chunk includes chess.js +
      chessground + framer-motion).
- [ ] `npm run preview` serves locally on `:4173` and the app loads.
- [ ] DevTools Network tab on a hard reload shows ALL 200s (no 404s
      for engine, puzzles.db, or opening-names.json).
- [ ] Service shows up at the target hostname with valid HTTPS.
- [ ] First visit on a fresh browser:
  - Tactics queue loads a puzzle within ~5 seconds (puzzles.db fetch).
  - Play vs engine produces a Stockfish move within ~10 seconds (engine
    + NNUE weights fetch).
  - Endgames loads a position and shows tablebase WDL (network OK).
- [ ] Second visit (warm cache): app loads in <2 seconds.
- [ ] After playing 3 puzzles, refresh — progress persists (IDB write
      verified).

## Things to defer (not blocking deploy, worth noting)

- **Service worker / true offline-after-first-load.** Browser HTTP cache
  + IndexedDB cover most of the win, but a SW gives the "works on the
  airplane" experience. Adding `vite-plugin-pwa` is a one-evening job.
- **Bundle size warnings.** Vite suggests code-splitting; could lazy-
  load Tactics / Endgames / Analysis routes to bring the initial JS
  payload under 500 KB.
- **CDN / R2 for the giant engine + puzzles.** Saves home bandwidth if
  multiple devices share. Trade-off: another moving piece, opt-in.
- **Multi-thread Stockfish upgrade.** Drops engine to ~30% of current
  binary size AND raises strength ~500 Elo, but requires COOP/COEP
  headers everywhere. Plan for v2.
