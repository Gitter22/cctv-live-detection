# Vigil: manual testing checklist

Every user-facing flow, with steps and what you should see. Tick the boxes as you go. Automated
versions of many of these exist: web (phase G, `docs/E2E_REPORT.md`) and mobile (`npm run e2e:mobile`).

## 0. Before you start

**Stack:** in WSL, from the repo root: `docker compose up -d`, then `docker compose ps`. All of postgres,
server, web, go2rtc, mosquitto, edge and vision should be Up.

| What | Where |
| --- | --- |
| Web app (on this PC) | `http://localhost:5173` |
| Web app (phone on the same Wi-Fi) | `http://192.168.1.33:5173` (the PC's Wi-Fi IP; check with `ipconfig` if it stops working) |
| Web app (Android emulator) | `http://10.0.2.2:5173` |
| go2rtc's own page (streams, debugging) | `http://localhost:1984` |

**Accounts:**
- **Your account** (`SUPERADMIN_EMAIL` in `.env`): platform admin **and** owner of the Home org (the real cameras).
- **Demo org "Acme Factory (E2E)"**: run `npm run e2e -w apps/server -- seed`. It creates an owner, admin and
  viewer, plus a viewer of your Home org. Their emails and passwords are in `data/e2e-credentials.json`.
  Seeding again resets the demo org and **changes those passwords**.

**Fake events for the demo org** (it has no real cameras). Run from the repo root:

```bash
npm run e2e -w apps/server -- event gate-1 zone.enter gate
```

| Command arguments | Triggers |
| --- | --- |
| `gate-1 zone.enter gate` | "Person at the gate" rule → **danger** alert |
| `press-3 zone.exit operator-area` | Starts the "Operator left machine" timer → **warning** after 30 s with nobody there |
| `gate-1 camera.status offline` | Camera offline (only alerts if a "Camera offline" rule exists) |
| `gate-1 face.observed gate` | A face event (only alerts if a face rule exists) |

Remove the demo org completely: `npm run e2e -w apps/server -- reset`.

---

## 1. Web app

### 1.1 Sign in and out
- [ ] **Wrong password:** enter a wrong password → an error message, no sign-in. After several quick failures, sign-in is slowed or blocked for a while (rate limit).
- [ ] **Sign in:** with your account → you land on your first organization's dashboard.
- [ ] **Sign out** (bottom left) → straight back to the sign-in page (fixed in this round).
- [ ] **Switch accounts:** sign in as an Acme user, copy the URL, sign out, sign in as `home-viewer@e2e.test`, paste the Acme URL → you're sent to **your own** org, not an error page (fixed in this round).
- [ ] **Session expiry:** after `JWT_TTL_HOURS` (default 12 h) you're asked to sign in again.

### 1.2 Platform admin (your account → **Admin** in the sidebar, or `/admin`)
- [ ] **Organization list:** every org, with its sites and edges (online/offline, last seen).
- [ ] **New organization:** name, slug, owner email (+ password for a new user) → it appears; the new owner can sign in and sees **only** that org.
- [ ] **Config without footage:** open an org you're not a member of → you can see sites and cameras, but Alerts, snapshots and live view are refused ("No footage access").

### 1.3 Organization settings (**Settings**)
**Sites, sources & edges tab**
- [ ] **Add site:** name, slug, timezone → a new tab appears for it.
- [ ] **Add source (NVR):** Kind *NVR (channels)*, vendor, host, RTSP port, username, password → listed as "… · password set". **The password is never shown again** (Edit has an empty password box; leave it empty to keep it).
- [ ] **Add source (raw RTSP URL)** → shown as "URL stored encrypted", never displayed.
- [ ] **Register edge:** shows a **token once** → copy it (it can't be shown again). It's listed with status, last seen and version. **Revoke** → that edge can no longer connect.

**Members tab** (owner or admin)
- [ ] **Add member:** email, role (Viewer / Admin / Owner), optionally limit to certain sites → they can sign in and see only what their role allows.
- [ ] **Change role / remove** → takes effect on their next page load.

**People (faces) tab:** see 1.8.

**Support access tab** (owner only)
- [ ] **Grant:** reason + hours → listed as **Active**. The platform admin can now open alerts and snapshots for this org.
- [ ] **Revoke** → status **Revoked**; the platform admin is blocked again immediately.

**Audit log tab** (owner only)
- [ ] Every change shows here with who and when: camera, zone, rule, source, member, support grants, **and each footage view by the platform admin**.
- [ ] **Filter** by type (Support access, Cameras, Rules, …) works.

### 1.4 Cameras (**Cameras**)
- [ ] **List:** key, label, stream (source channel / "Own URL"), tags, what it detects, zones, status (Online/Offline/Unknown).
- [ ] **Add camera from an NVR:** key like `entrance-1`, label, choose the source, channel number → within ~10 s the edge picks it up, and it goes **Online** on the dashboard with a thumbnail.
- [ ] **Add camera with its own URL:** paste `rtsp://…` → shown as "Own URL"; the URL is never displayed again.
- [ ] **Edit detection settings:** objects (person, car, …), confidence, detections/s, motion gate, faces → saved; vision applies it in seconds without restarting other cameras.
- [ ] **Disable a camera** (untick Enabled) → it stops being watched; **enable** → it comes back.
- [ ] **Tags** (e.g. `gate, outdoor`) → usable in rules ("Cameras with tag").

### 1.5 Zones and lines (open a camera → **Zones and lines**)
- [ ] The camera's current picture is the background.
- [ ] **Draw zone:** click corners, then click the first corner or press **Enter** to close; **Esc** cancels. Rename it on the right. **Save**.
- [ ] **Drag a corner** to adjust → Save → changes reach the edge within ~10 s.
- [ ] **Draw line:** click start and end → a direction arrow shows which way counts as "crossing in".
- [ ] **Delete** a zone (✕) → Save.
- [ ] **Real check (Home):** stand in / outside a zone at a real camera → only movement inside the zone (by the feet) triggers zone rules.

### 1.6 Rules (**Rules** → **New rule**)
For each rule type, create it, trigger it, and check the alert:

| Rule ("When") | Set up | Trigger | Expected |
| --- | --- | --- | --- |
| Something is present | Objects: person; zone; "stays at least" 0 s | Walk into the zone (Home) or `event gate-1 zone.enter gate` (Acme) | Alert within ~1 s |
| Something is present, stays ≥ N s | "Stays at least" 10 | Stay in the zone > 10 s | Alert only after 10 s; a short pass doesn't alert |
| Nobody / nothing present | Zone, "for at least" 30 s | `event press-3 zone.exit operator-area` and wait | Warning after 30 s |
| Too many / too few | e.g. more than 2 people in zone | Several people in the zone | Alert when the count is crossed |
| Crosses a line | A line on the camera, direction | Walk across it (each direction) | Alert only for the chosen direction |
| Camera offline | Cameras / tags | Disable the camera or unplug it | Alert after the offline delay; clears when back |
| A face is seen | Unknown faces only / a specific person | Walk to a face-enabled camera | See 1.8 |

Also check:
- [ ] **Cameras scope:** All / with tag / specific cameras. The zone list only offers zones of the chosen cameras.
- [ ] **Schedule:** "Only at certain times" (site timezone) → no alerts outside the window.
- [ ] **Cooldown:** with 300 s, a second trigger within 5 min doesn't make a new alert.
- [ ] **Severity** (info / warning / danger) and **custom alert title** show on the alert and the push.
- [ ] **Enable / disable** with the checkbox in the list → a disabled rule never alerts.
- [ ] The plain-English summary under the form matches what you set.

### 1.7 Alerts (**Alerts**)
- [ ] Keep the page open, trigger an alert → it appears **without reloading**, with a toast at the bottom right. The green dot by your name means "live updates connected".
- [ ] **Detail:** snapshot with the bounding box, time (site timezone), camera, rule.
- [ ] **Acknowledge** → it moves to the *Acknowledged* filter. **Close** → *Closed*. **Reopen** → back to *Open*.
- [ ] **Notes:** add a note → it shows with your name and time; other users see it too.
- [ ] **Filters:** status, severity, camera.
- [ ] **Watch live** from an alert → plays that camera.

### 1.8 Faces (People; camera setting "Recognise faces")
- [ ] Enable **Recognise faces** on one camera (uses the HD stream; more CPU).
- [ ] Create a rule "A face is seen" → unknown faces only.
- [ ] Walk past → alert **Unknown person (could not confirm)**.
- [ ] On that alert: **Mark as known person** → new person "Your name".
- [ ] Walk past again → no "unknown" alert (or an *info* "Known: Your name", depending on the rule).
- [ ] **People** tab: the person is listed with face samples; delete a sample or the person → unknown again.

### 1.9 Live view (camera page → **Watch live**, or from an alert)
- [ ] **SD** plays within a few seconds; the camera's clock overlay matches the current time.
- [ ] **HD** button → full resolution (2304×1296 on your NVR).
- [ ] **Stop** → the stream ends; go2rtc's page (`:1984`) shows no viewers for that stream.
- [ ] **Use LAN player** → go2rtc's own player (only works on your network).
- [ ] **Site offline** (a site with no edge, e.g. Acme) → "The site is offline." instead of spinning.
- [ ] **Firefox** (no H.265): HD should fall back to the H.264 version (not tested yet).

### 1.10 Dashboard
- [ ] Tiles: cameras online (x/y), open alerts, edge "seen Ns ago" (red if the edge is offline).
- [ ] A thumbnail per camera, refreshed every few seconds; Online / Offline / Unknown badge.
- [ ] **Site switcher** (if the org has several sites) → shows that site's cameras.

### 1.11 Roles and isolation (sign in as each demo user)
- [ ] **Viewer:** sees cameras, rules, alerts and live view; **no** Add / Edit / Delete buttons; can acknowledge, close and add notes.
- [ ] **Admin:** can change cameras, zones, rules, sources, members; **no** Support access or Audit log tabs.
- [ ] **Owner:** everything, including Support access and Audit log.
- [ ] **Other org:** `home-viewer@e2e.test` never sees Acme (and the reverse), even by pasting URLs.

---

## 2. Mobile app (Android)

**Install:** open the build's install link on the phone → install (allow "install unknown apps" for Chrome when asked).
Phone on the **same Wi-Fi** as the PC. First check that `http://192.168.1.33:5173` opens in the phone's Chrome.

### 2.1 Sign in
- [ ] **Server address** `http://192.168.1.33:5173` (emulator: `http://10.0.2.2:5173`), your email and password → **Sign in**.
- [ ] **Wrong password / wrong address** → a readable error, no crash.
- [ ] Android asks to **allow notifications** → Allow. A line under the filters says **"Push notifications on"**.
  If it says something else (e.g. "Notifications are switched off for this app"), that's the reason push won't work.
- [ ] Close the app completely and reopen → still signed in (the session is kept in Android's encrypted storage).

### 2.2 Alerts list
- [ ] The title is your org's name. **Open** / **All** filters.
- [ ] **Pull down** to refresh. With the app open, a new alert appears within ~15 s by itself.
- [ ] Colour bar by severity (red danger, amber warning, blue info), "x min ago", status.

### 2.3 Alert detail
- [ ] Snapshot loads (it's protected: only with your session), plus title, time, camera, rule.
- [ ] **Acknowledge** → status "acked". **Close** → "closed"; the button becomes **Reopen**.
- [ ] **Add a note** → it shows with your name. It also appears on the web for the same alert, and the reverse.
- [ ] Face alerts show "Known person" / "Unknown person".

### 2.4 Push notifications
- [ ] **App in the background** (press Home), trigger an alert → a notification within a few seconds:
  "🚨 Person in … / Camera entrance-1". Danger alerts use the louder "Danger alerts" channel.
- [ ] **Tap it** → the app opens **on that alert**.
- [ ] **App fully closed** (swipe it away from recents), trigger → notification arrives; tap → opens that alert.
- [ ] **Screen locked** → the notification shows on the lock screen.
- [ ] **App open** → a banner shows too.
- [ ] Android Settings → Apps → Vigil → Notifications: the channels "Alerts" and "Danger alerts" exist and can be tuned separately.

### 2.5 Live view
- [ ] From an alert → **Watch live** → video plays within a few seconds (same Wi-Fi).
- [ ] **SD / HD** toggle (top right).
- [ ] **Back** → the stream stops (no viewer left on go2rtc's page).
- [ ] **On mobile data (away from home):** expected to fail for now. It needs Tailscale or the TURN relay on a public hub.

### 2.6 Sign out
- [ ] **Sign out** (top right) → the sign-in screen (the blank-screen bug is fixed in the newest build).
- [ ] Trigger an alert after signing out → **no** notification on this phone (the token is unregistered).
- [ ] Sign in as a different user → you get only **their** org's alerts.

### 2.7 Resilience
- [ ] **Server down** (`docker compose stop server`) → the app shows an error instead of crashing; `docker compose start server` → it works again after a pull-to-refresh.
- [ ] **Phone offline then online** → the list recovers on refresh.

---

## 3. Server, edge and vision (behind the scenes)

Watch logs while testing: `docker compose logs -f server edge vision` (Ctrl+C to stop).

- [ ] **Health:** `http://localhost:5173/api/health` → OK.
- [ ] **Config push to the edge:** change a camera's label or a zone in the web → the edge log shows "config changed" and go2rtc/vision update within seconds (via the control channel, no polling wait).
- [ ] **Vision hot reload:** change a camera's detections/s → only that camera restarts in the vision log.
- [ ] **Camera offline/online:** disable a camera (or pull its cable at the NVR) → the vision log says "camera OFFLINE", the dashboard shows Offline, a "Camera offline" rule alerts; re-enable → ONLINE.
- [ ] **Events survive a server outage:** `docker compose stop server`, walk past a camera, wait 1 min, `docker compose start server` → the alert still arrives (the edge spooled it to disk and sent it later).
- [ ] **Edge offline:** `docker compose stop edge` → after ~1–2 min the dashboard shows the edge as not seen, and live view says the site is offline; start it → it recovers.
- [ ] **Real detection walk test (Home):** walk past each camera in turn → each gives exactly one alert per pass (no duplicates thanks to tracking and cooldown); note anything missed or any false alarm (e.g. the 0.41 box at the entrance).
- [ ] **Night test:** repeat after dark (IR mode) → note the detection quality.
- [ ] **Credentials never leak:** in the browser's DevTools (F12) → Network, click through Settings, Cameras and Alerts → no response contains the NVR password or a full `rtsp://user:pass@…` URL.
- [ ] **NVR lockout guard:** don't test this against your real NVR (Dahua locks the account after a few bad logins). It's covered by unit tests.
- [ ] **Not testable locally yet:** TURN relay (needs a public hub), live view from outside the home network.

---

## 4. After testing
- [ ] `npm run e2e -w apps/server -- reset` removes the demo org and its users.
- [ ] Delete `data/.env.before-b6` (an old backup with the NVR password).
- [ ] If you made test zones or rules on the Home org, remove them so they don't alert.
