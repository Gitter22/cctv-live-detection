# CLAUDE.md

Read `cctv-alerts-handover.md` for the full goal, hardware and plan. Key rules:

- **The detection core (`services/vision`) has no business rules.** It publishes generic VisionEvents only. Rules go in `apps/server`.
- **`services/vision` never touches the database.** Node (`apps/server`, Prisma) owns the schema and migrations.
- **go2rtc is the only component that connects to the NVR.** Vision reads `rtsp://go2rtc:8554/<stream>`.
- **Don't change the NVR's stream settings.** Handle everything in software.
- **Secrets live only in the root `.env`** (gitignored, password URL-encoded). Never put them in code, config files or chat. `config/go2rtc.yaml` uses `${NVR_PASSWORD}` substitution.
- The event contract is `packages/shared/schemas/vision-event.v1.json`. Bump the version for breaking changes.
- **No Ultralytics/YOLO (AGPL).** Use Apache/MIT models behind `vision/detectors/` (registry in `__init__.py`).
- Server: CommonJS. `packages/shared` must work from both CJS and bundlers.
- User: strong in React/Node, learning Python and React Native, beginner at networking. Explain network and device steps one at a time.

- Python deps are managed with **uv** (`services/vision/pyproject.toml` + `uv.lock`). Never add a requirements.txt.
- PyPI and GitHub can be very slow on the home network (an ISP routing issue), while Hugging Face is fast. Prefer `uv ... --offline` when the cache already has the packages.
- **Dahua locks accounts after a few failed logins.** Don't leave vision retrying with a wrong password.

Run vision tests: `cd services/vision && uv run python -m unittest discover -s tests -v`
