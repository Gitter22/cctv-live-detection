# Handover: CCTV real-time alerting system

Paste this into a new Claude Code chat opened in your WSL project folder (for example `~/projects/cctv-alerts`), or save it there as `HANDOVER.md` and tell Claude to read it first.

## Goal
Build a real-time alerting system that reads RTSP streams from home CCTV (live from the NVR, later also recordings), detects people, objects and actions, and sends alerts to a mobile app and a web app. The **detection core must contain no business rules**. It publishes generic events, and the rules live in a separate, config-driven layer. Today's use is a personal home. Later the same core should serve factories and shops by changing only the rules.

## About me (Aadil)
- Strong React developer. Prefer Node.js. Use Python where it fits naturally (ML and video). I can read Python but not write it yet, and I want to learn it. A Rust port is possible for a later commercial version (I'm new to Rust).
- I've never built a mobile app and want to learn React Native. At first the app is installed as an APK on trusted phones, without a store release.
- Use free tools wherever possible.
- I'm a beginner with networking. Explain network and device steps one at a time.

## Hardware and network (confirmed)
- Airtel router at `192.168.1.1` (gateway). LAN cables run to 2 TP-Link Omada extenders and the NVR.
- **NVR (Dahua family) at `192.168.1.17`**, with RTSP on port 554 and Dahua port 37777 open. Its web page doesn't load on port 80, so it's managed from the TV console.
- 4 cameras (XPIA brand) at `192.168.1.12` to `.15`, each with RTSP on port 554, directly on the LAN. We don't have their credentials yet. ONVIF Device Manager can find their RTSP links once we do.
- A view-only NVR user **`viewer`** exists (group `user`, Live + Search permissions on all 4 channels). The password is known to me only. **Never put passwords in code or chat. They go in the root `.env`, URL-encoded**, because a special character in the password broke the RTSP link in VLC.
- RTSP link that works in VLC:
  `rtsp://viewer:<PASSWORD>@192.168.1.17:554/cam/realmonitor?channel=<1-4>&subtype=<0 main|1 sub>`
- Sub stream: **H.265, 640×360, 25 fps**, VBR quality 3. **Don't change the NVR's stream settings.** Handle everything in software.
- Still to check: whether `subtype=1` and channels 2 to 4 play, and which channel shows which place (gate, balcony or terrace).

## Machines
- Development and demo: Windows laptop (i7 11th gen, no NVIDIA GPU) using **WSL + Docker Desktop (WSL backend)**.
- Later: a small home server running 24/7, reachable from anywhere through Tailscale.

## Repo and stack decisions
- **npm workspaces monorepo**, fully Dockerized, with **all config from one root `.env`**. Model it on my existing "tracker" project if Claude can access it.
- Layout:
  - `apps/server`: Node.js, **CommonJS modules**, standard **cookie + JWT auth**, Prisma + **Postgres** (add **pgvector** for face embeddings). Node owns the database schema and migrations.
  - `apps/web`: web app with the same features as the mobile app (React).
  - `apps/mobile`: React Native (Expo), in the same repo. Not part of Docker; built with Expo/EAS and installed as an APK.
  - `services/vision`: Python detection service. **It never touches the database.** It only publishes events.
  - `packages/shared`: event and alert types, API client and validation shared by web, mobile and server (must work for both CommonJS and bundlers).
- Docker Compose runs Postgres, the message broker, go2rtc, the vision service, the server and the web app. It does not run the mobile app.

## Vision pipeline design
- **Ingest:** go2rtc is the only component that connects to the NVR. It restreams to the vision service and provides the live view (WebRTC/HLS) for the apps. Decode with **PyAV** (ffmpeg). Use OpenCV only for image work.
- **Detection:** start with Ultralytics YOLO11 (easiest, but AGPL, so home use only) or go straight to **D-FINE / RT-DETRv2** (Apache-2.0, on Hugging Face). Put every detector behind one interface and run it through ONNX Runtime (OpenVINO on Intel CPUs), so models can be swapped through config.
- **Tracking and zones:** ByteTrack, plus polygon zones and line crossing, from Roboflow `supervision`.
- **Faces:** YuNet (detect) + SFace (recognise) from the OpenCV model zoo (permissive licences). Crop faces from the **main stream**. Treat "unknown" as "couldn't confirm".
- **Later:** a pose model (ViTPose/RTMPose) for actions; open-vocabulary detection (OWLv2/Grounding DINO) so businesses can define their own objects; an optional small VLM to double-check alerts. All of these stay off the per-frame path.
- **Reliability rules:** detect at about 5 fps on the sub stream and always use the latest frame (drop stale frames, never queue them). Each camera reconnects with backoff and sends heartbeats ("camera offline" is itself an alert). Fire only after N consecutive frames or a minimum time in the zone, with cooldowns per track and per rule. Keep a ring buffer for clips before and after each event. Use a versioned generic event schema (camera, zone, class, track ID, confidence, box, time, snapshot reference). Hide the broker behind an interface (MQTT/Mosquitto now, NATS JetStream if replay is needed). Store snapshots in MinIO or on disk, with metadata in Postgres. Collect metrics for fps, inference time and end-to-end alert latency.

## First alerts (home rules)
- A person at the **gate**, and a person on the **balcony/terrace**.
- Known face → **info** alert. Unknown face → **danger** alert.
- Send a snapshot and a link to the live stream immediately.

## Plan (agreed draft)
1. **Monorepo + detection core.** Scaffold the workspace, Docker Compose and root `.env`. Build `services/vision` to read the NVR streams through go2rtc, detect and track people, apply zones, and publish generic events with snapshots to the broker. Verify on the laptop against the real cameras.
2. **Node server + rules.** Auth, a config-driven rules engine, face enrolment and recognition, alert history in Postgres, and a web app showing alerts, snapshots and the live view.
3. **React Native app.** Push notifications (Firebase/Expo), snapshots, live view and history, installed as an APK.
4. **Home server.** The same Compose stack running 24/7, with remote access through Tailscale.

## Next step
Start step 1 in this folder. Check first that WSL can reach the NVR: `timeout 3 bash -c '</dev/tcp/192.168.1.17/554' && echo open`. Then check the git, node, python3, docker and docker compose versions.
