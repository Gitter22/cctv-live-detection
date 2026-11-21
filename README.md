# CCTV alerts

Real-time alerting for home CCTV, built so the same detection core can later serve shops and factories.

```
NVR (192.168.1.17) ──RTSP──▶ go2rtc ──RTSP──▶ services/vision ──MQTT──▶ apps/server (rules) ──▶ web / mobile
                              │                  │  detect (D-FINE)              │
                              │                  │  track (ByteTrack-style)      └─ Postgres + pgvector
                              │                  │  zones / lines
                              │                  └─ snapshots → data/snapshots/
                              └─ live view (WebRTC / HLS) for the apps
```

- **go2rtc** is the only thing that connects to the NVR.
- **services/vision** (Python) publishes *generic* events (`zone.enter`, `zone.exit`, `line.cross`, `camera.status`). It contains no business rules and never touches the database.
- **apps/server** (step 2) turns events into alerts using config-driven rules.
- The event contract lives in [`packages/shared/schemas/vision-event.v1.json`](packages/shared/schemas/vision-event.v1.json).

## Setup

1. Create your env file (gitignored) and set the NVR password **URL-encoded**:
   ```bash
   cp .env.example .env
   node -e "console.log(encodeURIComponent(process.argv[1]))" 'your-password'
   ```
   Paste the output into `NVR_PASSWORD=` in `.env`. Also change `POSTGRES_PASSWORD`.
2. Start everything:
   ```bash
   npm run up
   ```
3. Check the streams: open http://localhost:1984 (go2rtc) and click a stream. Then grab a still from every channel:
   ```bash
   npm run probe
   ```
   The images land in `data/snapshots/probe/`. Use them to name the cameras and draw zones in [`config/vision.yaml`](config/vision.yaml).
4. Watch the events:
   ```bash
   npm run events
   ```
   Snapshots are written to `data/snapshots/<camera>/<date>/<event id>.jpg`.

## MQTT topics (prefix `cctv/v1`)

| Topic | Contents |
| --- | --- |
| `events/<camera>/<type>` | Every VisionEvent |
| `cameras/<camera>/status` | Latest `camera.status` (retained) |
| `metrics/<camera>` | decode fps, detect fps, inference ms, frame age (retained, every 30 s) |
| `service/vision` | `{"online": true/false}` (retained, last will) |

## Tuning

- **Detector:** `DFINE_VARIANT` in `.env` (`n`, `s`, `m`, `l`, `x`), then `docker compose build vision`. Other models plug in through `services/vision/vision/detectors/`.
- **Detect rate:** `pipeline.detect_fps` in `config/vision.yaml` is per camera. One CPU detector is shared by all cameras. If it can't keep up, each camera gets fewer frames, but they are always fresh; there's never a queue.
- **Debounce:** `confirm_frames` and `exit_after_s`.

## Python development (uv)

The vision service is a [uv](https://docs.astral.sh/uv/) project: `services/vision/pyproject.toml` lists the dependencies and `uv.lock` pins their exact versions (like `package.json` and `package-lock.json`).

```bash
cd services/vision
uv sync                                  # create .venv with the locked packages
uv run python -m unittest discover -s tests -v
uv add <package>                         # add a dependency (updates uv.lock)
```

In Docker, the image runs `uv sync --frozen`. Setting `UV_CACHE_HOST_DIR` in `.env` lets the build reuse your local download cache.

Detector smoke test on an image (prints timing and writes `data/test.out.jpg`):

```bash
docker compose run --rm --no-deps -v "$PWD/data:/data" vision python tools/detect_image.py /data/test.jpg
```

## Performance (i7-11th gen CPU, measured)

| Model | Input | ms/frame |
| --- | --- | --- |
| D-FINE-S (default) | 640×384 (sub stream shape) | ~150 to 210 |
| D-FINE-S | 640×640 | ~230 to 270 |
| D-FINE-N | 640×384 | ~58, but scores too low to be useful |

That's about 5 detections per second shared across all cameras. The **motion gate** runs the detector only when something moves, when an object is being tracked, or every 2 s, so quiet cameras cost almost nothing.

## Licences

D-FINE (Apache-2.0), own ByteTrack-style tracker, go2rtc (MIT), Mosquitto (EPL/EDL). Ultralytics YOLO is deliberately **not** used (AGPL-3.0).
