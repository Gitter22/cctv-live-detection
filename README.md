# Vigil

Real-time alerting for CCTV across many organizations and sites. A **server** (the hub) manages organizations, sites, cameras, zones and rules. An **edge** at each site connects to the local NVR and cameras, runs detection and sends events up. Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · Progress: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

```
             SERVER (hub)                                EDGE (one per site, outbound only)
 web/mobile ─▶ apps/server ── Postgres+pgvector     ◀── apps/edge ── polls config, uploads events
              auth · orgs · sites · cameras · rules     │  writes go2rtc.yaml + vision.yaml
              encrypted camera credentials               ├─ go2rtc ◀── RTSP ── NVR / cameras
              events + snapshots                         └─ vision (detect, track, zones) ─MQTT─▶ edge
```

| Part | What it does |
| --- | --- |
| `apps/server` | TypeScript/Express API, Prisma. Users, organizations, sites, sources (NVR/camera credentials, encrypted), cameras, zones, edges, event ingest. |
| `apps/edge` | Edge agent. Knows only `SERVER_URL`, `EDGE_SITE_ID`, `EDGE_TOKEN`. Pulls its site's config, generates go2rtc + vision config, forwards events through a disk spool, sends health and thumbnails. |
| `services/vision` | Python detection core (D-FINE, own tracker, motion gate, zones). Generic events only, no business rules, no database. |
| `packages/shared` | zod schemas shared by everything (API bodies, VisionEvent, edge config). |
| go2rtc | The only component that talks to cameras/NVRs. Restreams for vision and live view. |

## Run it (this laptop: server + edge)

1. **Env file.** Copy and fill in (`.env` is gitignored):
   ```bash
   cp .env.example .env
   openssl rand -hex 32   # paste as JWT_SECRET
   openssl rand -hex 32   # paste as SECRETS_KEY (never change it later: stored credentials depend on it)
   ```
   Also set `POSTGRES_PASSWORD` and `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`. `COMPOSE_PROFILES=server,edge` runs both halves here.
2. **Start the hub** and create the platform admin:
   ```bash
   docker compose up -d postgres server
   npm install
   npm run seed -w apps/server
   ```
3. **Describe a site** (organization → site → source → cameras → zones) through the API (the web app comes in phase D). For the original home setup there's a one-time import: `npm run import:home -w apps/server`. It also registers the home edge and writes `EDGE_SITE_ID` / `EDGE_TOKEN` into `.env`.
4. **Start the edge:**
   ```bash
   docker compose up -d
   ```
   The edge fetches the config, go2rtc gets its streams, and vision starts detecting. Change a camera or zone in the API and the edge applies it within ~10 s (vision restarts only that camera).

### A remote site (edge only)

On the site's box: `COMPOSE_PROFILES=edge`, `EDGE_SERVER_URL=https://<hub>`, plus that site's `EDGE_SITE_ID` and `EDGE_TOKEN` (the token is shown once when the edge is registered). Only outbound connections are needed, no port forwarding.

## Useful commands

```bash
npm run logs            # all logs
npm run logs:vision
npm run events          # watch vision's MQTT events at the edge
npm run probe           # one still per camera stream -> data/probe/
```

Live streams: http://localhost:1984 (go2rtc UI; LAN only for now).

## Tests

```bash
npm test -w apps/server     # API + DB (separate <db>_test database)
npm test -w apps/edge
npm test -w packages/shared
cd services/vision && uv run python -m unittest discover -s tests -v
```

## Python (uv)

`services/vision` is a [uv](https://docs.astral.sh/uv/) project (`pyproject.toml` + `uv.lock`): `uv sync`, `uv run ...`, `uv add <pkg>`. The Docker build runs `uv sync --frozen`; set `UV_CACHE_HOST_DIR` in `.env` to reuse your local download cache.

## Performance (i7-11th gen CPU)

| Model | Input | ms/frame |
| --- | --- | --- |
| D-FINE-S (default) | 640×384 (sub stream shape) | ~150–210 |
| D-FINE-S | 640×640 | ~230–270 |
| D-FINE-N | 640×384 | ~58, but scores too low to be useful |

The motion gate runs the detector only when something moves, something is tracked, or every 2 s.

## Licences

D-FINE (Apache-2.0), own ByteTrack-style tracker, go2rtc (MIT), Mosquitto (EPL/EDL). Ultralytics YOLO is deliberately **not** used (AGPL-3.0).
