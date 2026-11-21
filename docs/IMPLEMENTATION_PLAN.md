# Implementation plan

Design: [ARCHITECTURE.md](ARCHITECTURE.md). Each task is a **self-contained unit of work with its own commit**. The checkbox is ticked in that same commit. Each phase ends with a milestone: commit and **push**.

Conventions:
- **Commit message:** starts with the task ID, e.g. `A3: Prisma schema and first migration`.
- **Done means tested:** a task is done only when its "Done when" check passes (tests, a curl, or a real camera).
- **Tasks needing you:** tasks marked 👤 need your action (hardware, accounts, a phone). I prepare everything, then pause for that step only.

Step 1 (done, `1d0a1ca`): monorepo, go2rtc, Mosquitto, Postgres, vision service with D-FINE, tracker, motion gate, zones and MQTT events.

---

## Phase A: Server foundation

| | ID | Task | Done when |
| --- | --- | --- | --- |
| [x] | A1 | **Server scaffold.** `apps/server`: TypeScript → CommonJS, Express, zod-validated env, `/api/health`, vitest, Dockerfile, Compose service, root scripts | `npm test -w apps/server` passes; `curl /api/health` returns OK from Docker |
| [x] | A2 | **Shared package in TypeScript.** `packages/shared`: zod schemas for VisionEvent v1 (matches the JSON Schema), common enums, topic helpers. Built to CJS + `.d.ts` | Server imports it; test validates a real vision event payload |
| [x] | A3 | **Database schema.** Prisma schema for all models in the architecture, first migration, `vector` extension, Prisma client in the server | `prisma migrate deploy` works on a fresh DB; schema test inserts and reads a site |
| [x] | A4 | **Secrets crypto.** AES-256-GCM helper with `SECRETS_KEY`, key-version prefix, redaction helper for API output | Unit tests: round trip, tamper detection, wrong key fails |
| [x] | A5 | **Auth.** Password hashing (scrypt, no native deps), login/logout/me, httpOnly cookie with JWT, rate limit on login, CSRF protection (SameSite + Origin check) | Tests: login OK/fail, cookie flags, protected route 401 |
| [x] | A6 | **Access layer.** Request context with memberships; `requireOrgRole`, site scoping, platform-admin rules (config only, no footage) in one place | Tests: user of org A gets 404 for every org B resource; viewer cannot write |
| [x] | A7 | **Organizations and members API.** Super admin creates orgs + first owner; owner/admin invite and manage members, roles, site limits | API tests for each role |
| [x] | A8 | **Sites API.** CRUD with timezone validation | API tests |
| [x] | A9 | **Sources API.** NVR/camera (vendor template) and raw URL kinds; secrets write-only (never returned) | Tests: password never appears in any response; URL built from template |
| [x] | A10 | **Cameras, zones and lines API.** Camera key, tags, channel, stream overrides, detection settings; zones/lines with normalised coordinates | API tests incl. validation of polygons |
| [x] | A11 | **Edges API.** Register edge (token shown once, stored hashed), revoke; edge auth middleware; `GET /edge/v1/config` returns resolved stream URLs + zones + detection settings for its site only | Tests: wrong/revoked token 401; edge of site X cannot read site Y |
| [x] | A12 | **Seed and home import.** Super admin from env; import script creates your org, home site, Dahua NVR source and the 4 cameras from today's config | Running it twice is idempotent; config endpoint output matches today's go2rtc/vision config |
| [x] | **A✓** | **Milestone: push** | |

## Phase B: Edge agent

| | ID | Task | Done when |
| --- | --- | --- | --- |
| [x] | B1 | **Edge scaffold.** `apps/edge` (TypeScript, Docker): env `SERVER_URL`, `SITE_ID`, `EDGE_TOKEN`; fetch config with retry and ETag; cache last good config on disk | Unit tests; runs against the local server |
| [x] | B2 | **go2rtc from config.** Generate `go2rtc.yaml` into a shared writable volume, restart go2rtc only when streams change | Streams in go2rtc match the server's cameras |
| [x] | B3 | **Vision from config.** Edge writes `vision.yaml`; vision watches it and hot-reloads only the changed cameras | Changing a zone in the API changes vision behaviour without a restart |
| [ ] | B4 | **Event forwarding.** Edge subscribes to local MQTT, uploads events + snapshots to `POST /edge/v1/events`; server stores Event + snapshot (disk store), idempotent by event ID; edge buffers on disk while the server is down | Real camera event appears in Postgres with its snapshot; survives a server restart |
| [ ] | B5 | **Health and thumbnails.** Edge heartbeat (version, camera status, metrics) → server; periodic camera thumbnails for the zone editor | `Edge.lastSeenAt` and camera online state update; thumbnails stored |
| [ ] | B6 | **Compose split.** `server` and `edge` Compose profiles; NVR credentials removed from `.env`; docs updated | Fresh `docker compose up` runs home cameras purely from server config |
| [ ] | **B✓** | **Milestone: push** | |

## Phase C: Rules and alerts

| | ID | Task | Done when |
| --- | --- | --- | --- |
| [ ] | C1 | **Rule schema and API.** zod rule schema in shared (scope, condition, schedule, severity, cooldown); CRUD with validation | API tests incl. invalid rules rejected |
| [ ] | C2 | **Rules engine core.** Pure TypeScript: scope matching, schedules in site timezone, zone occupancy, presence / absence / count / line / offline, cooldowns | Unit tests for each condition, incl. the factory examples |
| [ ] | C3 | **Engine wiring.** Run the engine on ingested events and on a timer (absence, offline); create Alerts | Integration test: event in → alert out |
| [ ] | C4 | **Events and alerts API.** List/filter, alert acknowledge/close/notes; snapshots served via permission check / signed URL | API tests incl. tenancy and footage rules |
| [ ] | C5 | **Live updates.** Server-Sent Events stream of alerts and camera status per org/site | Test client receives an alert within 1 s |
| [ ] | C6 | **Support grants and audit log.** Owner grants time-limited support access; every footage access and config change is audit-logged | Tests: super admin blocked without grant, allowed with one, logged |
| [ ] | C7 | **Home rules.** Seed rules: person at entrance, person on first floor / last floor at night, camera offline | Walk past a camera → alert row with snapshot |
| [ ] | **C✓** | **Milestone: push** | |

## Phase D: Web app

| | ID | Task | Done when |
| --- | --- | --- | --- |
| [ ] | D1 | **Web scaffold.** `apps/web` Vite + React + TypeScript, router, API client, login page, Docker (nginx) + Compose, proxy to server | Login works in the browser |
| [ ] | D2 | **Shell and dashboard.** Layout, org/site switcher, camera health overview | Shows real camera status |
| [ ] | D3 | **Admin screens.** Super admin: orgs, edges (token shown once), health. Org: members and roles | Create org + owner from the UI |
| [ ] | D4 | **Sites, sources, cameras.** Forms incl. vendor template vs raw URL, write-only secrets, tags, detection settings | Add a camera from the UI and it appears at the edge |
| [ ] | D5 | **Zone and line editor.** Draw polygons and lines on the camera thumbnail | Saved zone shows up in vision config |
| [ ] | D6 | **Rules editor.** Scope picker, condition forms, schedule, severity, cooldown | Create the factory example rules in the UI |
| [ ] | D7 | **Alerts.** Live feed (SSE), filters, detail with snapshot, acknowledge/close/notes | New alert appears without reload |
| [ ] | D8 | **Live view (LAN).** Play a camera via the site's go2rtc (WebRTC/MSE) after a server permission check | Live video plays from the alert detail |
| [ ] | **D✓** | **Milestone: push** | |

## Phase E: Faces

| | ID | Task | Done when |
| --- | --- | --- | --- |
| [ ] | E1 | **Face detection and embeddings in vision.** YuNet + SFace (OpenCV zoo), crop from the main stream for tracked persons, embedding in the event (no identity decisions at the edge) | Event carries a face embedding when a face is visible |
| [ ] | E2 | **Face enrolment and matching on the server.** People + face embeddings in pgvector; match with threshold; "unknown" = could not confirm | Unit + integration tests |
| [ ] | E3 | **Face conditions in rules + UI.** `face: known/unknown` condition; enrol faces from snapshots in the web app | Known face → info alert, unknown → danger alert |
| [ ] | **E✓** | **Milestone: push** | |

## Phase F: Remote live view and mobile app

| | ID | Task | Done when |
| --- | --- | --- | --- |
| [ ] | F1 | **Edge control channel.** Persistent WebSocket from edge to server (config change push, commands) | Config change reaches the edge within 1 s |
| [ ] | F2 | **Live view signalling.** Server relays WebRTC offer/answer to the site's go2rtc over F1, with short-lived camera tokens; web player uses it | Live view works without direct LAN access to go2rtc |
| [ ] | F3 | **TURN relay.** Optional coturn in Compose; ICE servers config to clients | Live view works with UDP blocked between peers |
| [ ] | F4 | **Mobile scaffold.** `apps/mobile` Expo + TypeScript, auth, shared API client | Runs in Expo Go / dev build |
| [ ] | F5 | **Mobile alerts.** Alert feed, detail with snapshot, acknowledge/close | Same alerts as the web |
| [ ] | F6 | **Push notifications.** Device registration API; Expo push on alert | Phone gets a push for a new alert 👤 |
| [ ] | F7 | **Mobile live view.** WebRTC player via F2 | Tap alert → live video on the phone 👤 |
| [ ] | F8 | **APK build.** EAS/local build, install instructions | APK installed on your phone 👤 |
| [ ] | **F✓** | **Milestone: push** | |

## Phase G: End-to-end browser testing (Chrome DevTools)

| | ID | Task | Done when |
| --- | --- | --- | --- |
| [ ] | G1 | **E2E fixtures.** Seed two orgs (home + demo factory) with users per role; test-event injector for a camera | Repeatable reset + seed command |
| [ ] | G2 | **Admin and config flows.** In Chrome: super admin creates org, owner adds site/source/camera/zone/rule; edge picks it up | All steps pass; screenshots saved |
| [ ] | G3 | **Alert flows.** Injected and real events → live alert in the browser → acknowledge → close; live view plays | All steps pass; console has no errors |
| [ ] | G4 | **Security flows.** Cross-org access attempts, viewer write attempts, super admin footage without/with support grant, secrets never visible in network responses | Every attempt correctly denied/allowed (DevTools network log checked) |
| [ ] | G5 | **E2E report.** `docs/E2E_REPORT.md` with results, screenshots, found bugs and fixes | Report committed |
| [ ] | **G✓** | **Milestone: push** | |
