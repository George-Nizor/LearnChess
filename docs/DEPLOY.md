# Deploy — home-lab self-hosting

> Status: **wired up.** The repo now ships a multi-stage `Dockerfile`,
> `docker-compose.yml`, and `deploy/nginx.conf`. The Compose default
> profile assumes you have an existing reverse proxy (Caddy/Traefik/
> nginx-proxy-manager); a `standalone` profile with bundled Caddy is
> commented in for users who don't.

## Quick start

```bash
# behind your existing reverse proxy:
docker compose up -d --build
# point your proxy at host:8080

# standalone HTTPS via bundled Caddy (uncomment the caddy service in
# docker-compose.yml first), then:
CADDY_DOMAIN=chess.example.com docker compose --profile standalone up -d
```

That's the whole deploy. The image takes ~3 minutes to build from
scratch (the `npm run build:puzzles` step does a 280 MB Lichess CSV
download + 30s of CPU, layer-cached on subsequent builds unless
package.json or scripts change).

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

### Option C — Docker / Compose (recommended; what the repo ships)

The repo includes a real `Dockerfile`, `docker-compose.yml`, and
`deploy/nginx.conf`. You get a ~150 MB final image (nginx + brotli +
the static dist) that runs as the unprivileged `nginx` user on port
8080.

The default Compose profile assumes you already have a reverse
proxy fronting your home-lab services (Caddy, Traefik, nginx-proxy-
manager, HAProxy, etc.) — it just exposes port 8080 and lets your
proxy handle HTTPS + domain routing. There's also an opt-in
`standalone` profile (commented out in compose) that adds a Caddy
sidecar with auto Let's Encrypt for users without an existing proxy.

```bash
# Behind your existing reverse proxy
docker compose up -d --build
# Point your proxy at <docker-host>:8080

# OR standalone with bundled Caddy + Let's Encrypt
# (uncomment the `caddy:` service in docker-compose.yml first)
CADDY_DOMAIN=chess.example.com docker compose --profile standalone up -d

# Update flow
docker compose pull && docker compose up -d
# OR rebuild monthly to pick up new Stockfish + puzzles:
docker compose build --no-cache learnchess && docker compose up -d
```

What the build does internally (3 stages, see `Dockerfile`):

1. **Builder** (`node:22-alpine`): `npm ci` → `npm run vendor:engine`
   → `npm run build:puzzles` → `npm run build`. Output: `/app/dist`
   (~150 MB).
2. **Compressor** (`alpine:3.20` + brotli + gzip): walks the dist,
   pre-compresses every text-like asset (.js, .css, .wasm, .db,
   .json, .svg) at brotli q6 + gzip -9 so nginx serves precompressed
   variants without per-request CPU.
3. **Runtime** (`fholzer/nginx-brotli`): ~15 MB Alpine nginx with
   the brotli module baked in. Drops to non-root, listens on 8080,
   reads `deploy/nginx.conf` for vhost + cache headers.

The image is read-only at runtime (`read_only: true` in compose) —
nothing writes to disk except nginx's tmpfs cache. There's no
per-user state stored server-side, so there's nothing to back up
on the server.

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
