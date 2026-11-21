# Architecture: multi-site CCTV alerting

Status: **agreed design**, 2026-11-21. Tasks and progress: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## Goals

- One **server** (hub) manages many **organizations**, each with one or more **sites**.
- Each site runs an **edge** (go2rtc + vision + edge agent) on its local network, next to its NVR or cameras.
- All site configuration (connections, cameras, zones, rules) lives on the server. An edge only knows which site it is.
- Owners see only their own data. The platform admin (us) manages configuration and health but **cannot see footage or events** without support access granted by the owner.
- The detection core (vision) stays generic: no business rules, no database.

## Decisions

| Topic | Decision |
| --- | --- |
| Hierarchy | **Organization → Site → Source → Camera → Zones/Lines**; **Rules** per site |
| Tenancy | **One Postgres DB**, every row scoped by `organizationId`, enforced in the API layer |
| Server stack | **TypeScript, compiled to CommonJS**, REST, zod schemas in `packages/shared`, Prisma |
| Edge config | **Edge pulls** from the server using `SERVER_URL` + `SITE_ID` + `EDGE_TOKEN`; outbound only |
| Secrets | **AES-256-GCM** with `SECRETS_KEY` (server `.env`), as in trackr. Write-only in the API |
| Platform admin | **Configuration and health only.** Footage and events need a time-limited support grant from the org owner; every access is audit-logged |
| Live view | **On demand** (only while someone watches), **straight from the site's go2rtc to the viewer's phone or browser** (WebRTC, like a video call). The server only checks permission and introduces the two ends; it never carries video. LAN/Tailscale first; relay (TURN) for strict networks later |
| Rules | **Per site, each with a scope**: all cameras, cameras with a tag, or specific cameras/zones. Different cameras can follow different rules |
| Detection settings | **Per camera** (classes, confidence, model). Generic, so they live with the camera, not in rules |
| Continuous video to server | **No.** Recording stays on the NVR. Edge uploads events, snapshots, health and (later) short alert clips |

## Components

```
                         ┌──────────────────────── SERVER (hub) ────────────────────────┐
   web / mobile  ──────▶ │  apps/server (TS, REST)   Postgres + pgvector   snapshot store │
   (cookie + JWT)        │  auth · orgs · sites · cameras · rules engine · alerts · audit │
                         └───────────────▲──────────────────────────┬────────────────────┘
                                         │ HTTPS/WebSocket, outbound │ signalling for live view
                                         │ from the edge only        ▼
   ┌──────────────────────────── EDGE (one per site) ─────────────────────────────────┐
   │ apps/edge (agent, Node TS)                                                        │
   │   · fetches site config (decrypted creds) · writes go2rtc + vision config · reload │
   │   · forwards events + snapshots from local MQTT to the server · health heartbeat   │
   │ go2rtc ◀── RTSP ── NVR / cameras        vision (Python) ──MQTT──▶ mosquitto (local) │
   └───────────────────────────────────────────────────────────────────────────────────┘
```

- **Mosquitto becomes edge-local.** The server never connects into a site; the edge agent forwards events upward.
- **Vision is unchanged in spirit.** It reads a generated `vision.yaml` (hot-reloaded on change) instead of a hand-written one.
- **go2rtc** gets a generated config and a writable config directory, so streams can be added or updated through its API.
- Today the server and the home edge run in the **same Docker Compose** on one machine.

## Data model (server, Prisma)

| Model | Key fields | Notes |
| --- | --- | --- |
| `User` | email, passwordHash, name, `platformRole` (`SUPER_ADMIN` or none) | |
| `Organization` | name, slug | |
| `Membership` | userId, organizationId, `role` (`OWNER`, `ADMIN`, `VIEWER`), `siteIds[]` (empty = all sites) | Org access |
| `Site` | organizationId, name, slug, timezone | A physical location |
| `Edge` | siteId, name, `tokenHash`, lastSeenAt, version, status | Token shown once; revocable |
| `Source` | siteId, name, `kind` (`NVR`, `CAMERA`, `RAW_URL`), `vendor` (`dahua`, `hikvision`, `onvif`, `generic`), host, rtspPort, username, `passwordEnc`, `rawUrlEnc` | How to reach video |
| `Camera` | siteId, sourceId, `key` (e.g. `entrance-1`), label, channel, `subUrlEnc`/`mainUrlEnc` overrides, enabled, `tags[]` (e.g. `gate`, `machine-area`), `detection` JSON (classes, confidence, model) | Key is the stream/camera ID at the edge. Detection settings are generic, not rules |
| `Zone` / `Line` | cameraId, key, label, polygon / start + end (normalised 0..1) | Drawn in the web app |
| `Rule` | siteId, name, enabled, `scope` (all cameras / tags / camera + zone list), `when` (condition, see below), `then` (severity, notify channels), cooldownS | Config-driven rules engine, versioned JSON validated by zod |
| `Event` | siteId, cameraId, type, ts, payload JSON, snapshotKey | Raw VisionEvents |
| `Alert` | siteId, ruleId, eventId, severity, status (`OPEN`, `ACKED`, `CLOSED`) | Output of rules |
| `SupportGrant` | organizationId, grantedBy, expiresAt, reason | Unlocks footage for platform admin |
| `AuditLog` | actor, organizationId, action, target, at | Every footage access and every config change |

### Rules: scope and conditions

Each rule targets part of a site, so a gate camera and a machine camera can follow different rules:

| Scope | Example use |
| --- | --- |
| `all` | Home: one rule for every camera |
| `tags: [gate]` | Shop chain: every camera tagged `gate` |
| `targets: [{camera: press-3, zone: operator-area}]` | Factory: one machine's operator area |

Condition types (the rules engine keeps zone occupancy from `zone.enter`/`zone.exit`, so no vision changes are needed):

| Condition | Meaning | Example |
| --- | --- | --- |
| `presence` | object of class X enters zone, optionally staying ≥ N s | person at gate |
| `absence` | **no** object of class X in zone for ≥ N s | operator left machine for 60 s |
| `count` | more than / fewer than N objects in zone for ≥ N s | > 2 people at machine |
| `line_cross` | crossing a line in a direction | someone entered through the gate |
| `camera_offline` | camera offline ≥ N s | tampering / power cut |
| `face` (later) | known / unknown face | unknown person → danger |

All conditions can take a **schedule** (days and time windows in the site's timezone) and a **cooldown**.

Example factory rules:

| Rule | Scope | When | Then |
| --- | --- | --- | --- |
| After-hours intruder | tag `gate` | `presence` person in zone `gate`, 22:00–06:00 | danger |
| Operator left machine | `press-3` / `operator-area` | `absence` person ≥ 60 s, shift hours | warning |
| Crowding at machine | `press-3` / `operator-area` | `count` person > 2 for ≥ 10 s | warning |

**Vendor templates** build RTSP URLs from source + channel (for example Dahua: `/cam/realmonitor?channel={ch}&subtype={0|1}`), so most cameras need only host, credentials and channel.

## Roles and permissions

| Can… | `VIEWER` | `ADMIN` | `OWNER` | Platform `SUPER_ADMIN` |
| --- | --- | --- | --- | --- |
| Watch live feeds of their cameras | ✅ | ✅ | ✅ | only with support grant |
| See events, snapshots, alerts | ✅ | ✅ | ✅ | only with support grant |
| Acknowledge / close alerts, add notes | ✅ | ✅ | ✅ | — |
| Manage sources, cameras, zones, rules | — | ✅ | ✅ | ✅ (configuration) |
| Manage users of the org | — | ✅ | ✅ | ✅ |
| Grant support access, delete org | — | — | ✅ | — |
| Create orgs and sites, register/revoke edges, see health of all sites | — | — | — | ✅ |

Any membership can be limited to some sites (`siteIds`). Camera-level limits can be added later.

## Security rules

1. **Encrypted secrets:** passwords and raw URLs are encrypted at rest and never returned by the API (the UI shows "set" or "not set").
2. **Decryption is limited to edge delivery:** secrets are decrypted only into the config response for that site's authenticated edge.
3. **Edge tokens are hashed:** they're stored as hashes, bound to exactly one site, and revocable.
4. **Every query is scoped:** by `organizationId` (and `siteIds` for limited memberships) in one central access layer, never ad hoc.
5. **Snapshots and clips stay private:** they're served only through the API after a permission check, or via short-lived signed URLs.
6. **Live view checks permission each time:** a session needs a fresh permission check and a short-lived, camera-specific token.
7. **The platform admin is limited:** footage or events are denied unless an active `SupportGrant` exists, and every access is written to `AuditLog`.

## Implementation

The phased task list lives in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
