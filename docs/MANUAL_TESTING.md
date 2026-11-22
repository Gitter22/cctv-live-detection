# Vigil: manual test scripts

Step-by-step scripts for every flow, web first, then mobile, then the backend. Each script lists who
to sign in as, the steps, and what you should see (**→**). Tick the boxes as you go.

Automated versions of many of these exist: web (phase G, `docs/E2E_REPORT.md`) and mobile
(`npm run e2e:mobile`, `docs/MOBILE.md`).

---

## 0. Read this first

### 0.1 Who's who

There is **no public sign-up**. Every account is created by someone above it:

```
Platform admin (you, from .env)   creates organizations, each with its first Owner
  └─ Owner                         adds Admins and Viewers to their organization
       └─ Admin                    adds Admins and Viewers too
            └─ Viewer              can't add anyone
```

A person can belong to several organizations, with a different role in each. Members can be limited
to **some sites** of an organization.

### 0.2 What each role can do

| | Viewer | Admin | Owner | Platform admin (not a member) |
| --- | :-: | :-: | :-: | :-: |
| See sites, sources, cameras, zones, rules, edges | ✅ | ✅ | ✅ | ✅ |
| Change any of those (add/edit/delete, register edges) | ❌ | ✅ | ✅ | ✅ |
| Add / change / remove members | ❌ | ✅ | ✅ | ✅ |
| See alerts, snapshots, live view, people (faces) | ✅ | ✅ | ✅ | ❌ (✅ only during a **support grant**) |
| Acknowledge / close / add notes to alerts | ✅ | ✅ | ✅ | ❌ |
| Support access tab (grant/revoke), delete the organization | ❌ | ❌ | ✅ | ❌ |
| Audit log tab | ❌ | ❌ | ✅ | ✅ |
| Platform admin page (all orgs, create orgs) | ❌ | ❌ | ❌ | ✅ |
| Receives push notifications on the phone | ✅ | ✅ | ✅ | ❌ |

What each role sees in the **sidebar**:

| Viewer | Admin | Owner | Platform admin |
| --- | --- | --- | --- |
| Dashboard, Alerts, Cameras, Rules, Settings | same | same | the same **plus "Platform admin"** at the bottom |

Under **Settings**:

| Viewer | Admin | Owner | Platform admin |
| --- | --- | --- | --- |
| Sites, sources & edges (read-only); People (faces) | + Members; everything editable | + **Support access**, **Audit log** | Sites, sources & edges; Members; Audit log |

### 0.3 Addresses

| Where you test from | Web app address |
| --- | --- |
| This PC | `http://localhost:5173` |
| Phone on the same Wi-Fi | `http://192.168.1.33:5173` (the PC's Wi-Fi IP; check with `ipconfig` if it stops working) |
| Android emulator | `http://10.0.2.2:5173` |
| go2rtc's own page (streams, viewers, debugging) | `http://localhost:1984` |

### 0.4 Test accounts: make them yourself

These scripts create the accounts **through the UI**, which tests the flows themselves. Use made-up
emails on the `.test` domain (they never receive mail) and passwords of at least 10 characters.
Write the passwords down somewhere private. Don't reuse real passwords.

| Account | Created in | Role |
| --- | --- | --- |
| Your account (`SUPERADMIN_EMAIL` in `.env`) | `npm run seed -w apps/server` (already done) | Platform admin + owner of **Home** |
| `owner@shop.test` | W-03 | Owner of "Corner Shop" |
| `admin@shop.test` | W-10 | Admin of "Corner Shop" |
| `viewer@shop.test` | W-10 | Viewer of "Corner Shop", all sites |
| `night@shop.test` | W-10 | Viewer of "Corner Shop", **Warehouse site only** |

There's also a ready-made demo org: `npm run e2e -w apps/server -- seed` creates "Acme Factory (E2E)"
with users per role, plus a viewer of Home. Passwords are in `data/e2e-credentials.json`, and they
change on every seed.

### 0.5 Making alerts happen

- **Real (Home):** walk past a camera.
- **Fake (Acme demo org only, no real cameras):** from the repo root:
  ```bash
  npm run e2e -w apps/server -- event gate-1 zone.enter gate
  ```
  Other arguments: `press-3 zone.exit operator-area` (absence timer, warning after 30 s), `gate-1 camera.status offline`, `gate-1 face.observed gate`.

**Tip:** use two browser windows (one normal, one Incognito) to be signed in as two people at once.

---

## Part 1: Web app

### W-01 Sign in, sign out, sessions
*As: your account.*

1. [ ] Open `http://localhost:5173` → you're sent to the **sign-in** page.
2. [ ] Enter your email with a **wrong password** → "Wrong email or password", still on the sign-in page.
3. [ ] Repeat the wrong password ~10 times quickly → sign-in is **rate-limited** (an error saying to wait). Wait a minute.
4. [ ] Sign in correctly → you land on your first organization's **Dashboard**. The bottom left shows your name, a green dot (live updates connected) and your role.
5. [ ] Reload the page → still signed in (session cookie).
6. [ ] Click **Sign out** → straight to the sign-in page.
7. [ ] Press the browser's **Back** button → you can't see the old page's data (it sends you to sign-in).
8. [ ] Optional: after `JWT_TTL_HOURS` (default 12 h) idle, any click sends you to sign-in.

### W-02 Platform admin overview
*As: your account (platform admin).*

1. [ ] Sidebar → **Platform admin** → the "Platform admin" page lists **every organization** with its sites, camera counts, and per site: edge **seen Xs ago**, and **vision up/down**. A green dot means the edge reported in the last 90 s.
2. [ ] Click **Open** on an organization you're **not** a member of (e.g. Acme) → its dashboard opens. The role at the bottom left says **Platform admin**.
3. [ ] **Dashboard** of that org → cameras are listed, but footage shows **"No footage access"**.
4. [ ] **Alerts** → "You don't have access to alerts."
5. [ ] **Cameras**, **Rules**, **Settings → Sites, sources & edges**, **Members**, **Audit log** → all visible and editable.

### W-03 Create an organization and its owner
*As: platform admin.*

1. [ ] **Platform admin** → **New organization**.
2. [ ] Name `Corner Shop`, slug `corner-shop`, Owner email `owner@shop.test`, Owner name `Shop Owner`, Owner password (10+ characters) → **Create**.
   → "Corner Shop" appears in the list with "No sites".
3. [ ] Try creating another org with the **same slug** → an error; nothing created.
4. [ ] Try a slug with capitals or spaces (`Corner Shop`) → the form refuses it.
5. [ ] **Existing user as owner:** create org `Second Shop` / `second-shop` with owner `owner@shop.test` and **no password** → created; that user now has two orgs (checked in W-04).

### W-04 Owner's first sign-in
*As: `owner@shop.test` (Incognito window).*

1. [ ] Sign in → **Corner Shop** dashboard: "No sites yet. Add one under Settings."
2. [ ] The sidebar has **no** "Platform admin". The bottom left says **OWNER**.
3. [ ] The **organization switcher** (top of the sidebar) lists Corner Shop and Second Shop; switching changes everything below.
4. [ ] Paste a URL of an org you don't belong to (copy one from your platform admin window) → you're sent back to your own org.

### W-05 Sites
*As: owner of Corner Shop.*

1. [ ] **Settings → Sites, sources & edges**. In **New site**, enter `Front store`, slug `front-store`, timezone `Asia/Kolkata` → **Add site** → a "Front store (Asia/Kolkata)" tab appears.
2. [ ] Add a second site `Warehouse` / `warehouse` → two tabs. The sidebar now has a **Site** switcher; the Dashboard, Cameras and Rules follow it.
3. [ ] A wrong timezone (e.g. `Mars/Base`) → refused.
4. [ ] *Gap:* renaming or deleting a site isn't in the UI yet (the API supports it).

### W-06 Sources (NVRs and cameras)
*As: owner. Site: Front store.*

The **source** is the device holding the video: an NVR (many channels), a single IP camera, or a raw RTSP URL.

1. [ ] **Add source** → Name `Shop NVR`, Kind **NVR (channels)**, Vendor **Dahua / CP Plus / Amcrest**, Host `10.0.0.50` (a made-up address is fine for this test), RTSP port `554`, Username `viewer`, Password `any-test-password` → **Save**.
   → Listed as "NVR · dahua", address `10.0.0.50:554`, credentials "viewer · **password set**".
2. [ ] **Edit** it → the password box is **empty** (passwords are never shown again). Change only the name and save → the password is still set.
3. [ ] **Add source** → Kind **Raw RTSP URL**, URL `rtsp://user:secret@10.0.0.60:554/stream1` → listed as "**URL stored encrypted**". It's never displayed again anywhere.
4. [ ] Press **F12** → Network tab, reload the Settings page, click the `sources` request → its response has **no password and no URL**, only `passwordSet: true` style fields.
5. [ ] **Real NVR** (Home only): it's already set up. Don't change its password here unless you mean to: a wrong password makes Dahua **lock the account**.

### W-07 Edge agent: register and deploy

The **edge** is the box at a site that talks to its cameras (go2rtc + vision + the edge agent). It only
makes **outgoing** connections to the server: no port forwarding at the site.

#### W-07a Register an edge (any site)
*As: owner or admin.*

1. [ ] **Settings → Sites, sources & edges** → choose the site tab → **Edges** → **Register edge** → name `Front store box` → Register.
2. [ ] A window **"Edge token (shown once)"** shows:
   ```
   EDGE_SITE_ID=<site id>
   EDGE_TOKEN=edg_…
   # EDGE_SERVER_URL=https://<this server>
   ```
   Click **Copy** and keep it somewhere private. Close the window → it can **never** be shown again.
3. [ ] The edge is listed as **Active**, last seen "never".
4. [ ] **Revoke** it → confirm → status **Revoked**. A box using that token is now refused (W-07c shows how to see that).

#### W-07b Deploy an edge on a real site box (Linux mini PC / NUC with Docker)
Do this when you have a second site. On the **site box**:

1. [ ] Install Docker (Ubuntu: `curl -fsSL https://get.docker.com | sh`).
2. [ ] Copy the repo there (`git clone …`), then `cp .env.example .env`.
3. [ ] In `.env` set:
   ```
   COMPOSE_PROFILES=edge
   EDGE_SERVER_URL=https://<your hub address>     # how this box reaches the server
   EDGE_SITE_ID=…                                  # from W-07a
   EDGE_TOKEN=edg_…                                # from W-07a
   EDGE_LIVE_URL=http://<this box's LAN IP>:1984
   EDGE_WEBRTC_CANDIDATES=<this box's LAN IP>:8555,stun:8555
   ```
4. [ ] `docker compose up -d` → `docker compose ps` shows go2rtc, mosquitto, edge, vision Up.
5. [ ] Back in the web app (Settings → Edges) → that edge shows **last seen a few seconds ago** and a version. The Platform admin page shows a **green dot** for the site.
6. [ ] Add a source and cameras for that site (W-06, W-08) → within ~10 s the box's go2rtc has the streams (`http://<box>:1984`) and the dashboard shows the cameras **Online** with thumbnails.

The hub must be reachable from the box: the same network, Tailscale, or a public HTTPS address.

#### W-07c Rotate the Home edge's token (safe test on this PC)
This re-deploys the existing edge with a new token, then revokes the old one.

1. [ ] As your account: Home → Settings → **Register edge** `Home box (new)` → copy the two lines.
2. [ ] In WSL, open `.env` and replace the values of `EDGE_SITE_ID` and `EDGE_TOKEN` with the new ones. Save.
3. [ ] `docker compose up -d edge` → `docker compose logs --tail 20 edge` shows "config fetched" / "control channel connected".
4. [ ] Web → Edges: **Home box (new)** is seen just now; the old edge's "last seen" stops updating.
5. [ ] **Revoke** the old edge → cameras stay Online (the new edge carries on).
6. [ ] Negative test: put the **old** token back in `.env`, `docker compose up -d edge` → the edge log shows **401 / unauthorized** and the site goes stale. Put the new token back.

### W-08 Cameras
*As: owner or admin.*

1. [ ] **Cameras** → **Add camera**:
   - Key `entrance-9` (lowercase, used in rules and stream names), Label `Shop entrance`
   - Source `Shop NVR` → a **Channel** box appears → `1`
   - Tags `entrance, outdoor`
   - Detect **person** (+ car if you like), Confidence `0.5`, Detections/s `5`, Motion gate on, Recognise faces off
   - **Save** → listed with stream "Shop NVR · ch 1", status **Unknown** (no edge at this site yet).
2. [ ] **Duplicate key** (`entrance-9` again) → error.
3. [ ] **Own URL:** Source *None (own URL)* → paste `rtsp://…` in "Detection stream URL (sub)" (and optionally HD) → stream shows "Own URL"; the URL is never shown again.
4. [ ] **Edit** → change Detections/s to 2 → Save. On Home, `docker compose logs -f vision` shows **only that camera** restarting.
5. [ ] **Untick Enabled** → Home: the camera goes Offline/Unknown within ~10 s and stops alerting; tick it again → Online.
6. [ ] **Delete** → "Delete camera …? Its zones are deleted too." → gone (alerts already raised stay).
7. [ ] **Real camera (Home):** the 4 NVR channels are Online with live thumbnails on the Dashboard.

### W-09 Zones and lines
*As: owner or admin. A Home camera is best (real background picture).*

1. [ ] **Cameras** → **Zones** on a camera → the latest still is the background.
2. [ ] **Draw zone** → click 4 corners → click the first corner (or press **Enter**) → the zone appears, named "Zone 1". **Esc** while drawing cancels.
3. [ ] Rename it on the right (e.g. `Doorstep`) → its key becomes `doorstep` → **Save**.
4. [ ] **Drag a corner** → Save → `docker compose logs edge` shows the config change within ~10 s.
5. [ ] **Draw line** → click start and end → an arrow shows the "in" direction → name it → Save.
6. [ ] **✕** to delete a zone → Save.
7. [ ] Real check: stand **just outside** the zone → no zone alert; step **in** (your feet inside) → zone alert.

### W-10 Members and roles
*As: `owner@shop.test`.*

1. [ ] **Settings → Members** → add `admin@shop.test`, name, password, role **ADMIN**, all sites → listed.
2. [ ] Add `viewer@shop.test`, role **VIEWER**, all sites.
3. [ ] Add `night@shop.test`, role **VIEWER**, tick only **Warehouse** → the Sites column says "Warehouse".
4. [ ] Add an **existing** user (e.g. `owner@shop.test` into Second Shop is already there; try adding `viewer@shop.test` to Second Shop) **without** a password → added; their org switcher now shows both.
5. [ ] Change `viewer@shop.test`'s role to ADMIN in the dropdown → saved; set it back to VIEWER.
6. [ ] **Remove** a member → confirm → they can't open the org any more (next page load sends them to their other org, or "You are not a member of any organization yet").
7. [ ] As **admin@shop.test**: Members tab is there; Support access and Audit log tabs are **not**.
8. [ ] As **viewer@shop.test**: there's no Members tab, no Add/Edit/Delete buttons anywhere, and Sources/Edges are read-only.
9. [ ] As **night@shop.test**: only the **Warehouse** site exists for them (no site switcher, no Front store cameras or alerts).

### W-11 Rules
*As: owner or admin (a viewer sees rules but can't change them).*

**Rules** → **New rule**. For each row, build it, trigger it, and check the alert:

| # | When | Set up | Trigger | → Expected |
| --- | --- | --- | --- | --- |
| 1 | Something is present | Cameras: specific; Objects: person; Zone: doorstep; stays 0 s; danger; cooldown 0 | Step into the zone | Danger alert within ~1 s |
| 2 | Something is present, stays ≥ N s | Same, stays at least `10` | Stand there 15 s / walk through in 3 s | Alert only for the long stay |
| 3 | Nobody / nothing present | Zone; for at least 30 s | Leave the zone (Acme: `event press-3 zone.exit operator-area`) | Warning after 30 s |
| 4 | Too many / too few | More than 1 person in a zone | Two people in the zone | Alert when the count is crossed |
| 5 | Crosses a line | A line; direction in/out/either | Walk across it each way | Only the chosen direction alerts |
| 6 | Camera offline | Cameras with tag `outdoor` | Untick Enabled on that camera | Alert after the offline delay; clears when back |
| 7 | A face is seen | Unknown (couldn't confirm) / Known person / Any face | See W-15 | Matches the choice |

Then check each option on one rule:
- [ ] **Cameras: All / with tag / specific** → the zone list only offers zones of the chosen cameras.
- [ ] **Only at certain times** → days + From/To (site timezone; overnight like 22:00–06:00 works) → no alerts outside the window.
- [ ] **Cooldown 300 s** → a second trigger within 5 minutes makes **no** new alert.
- [ ] **Severity** info / warning / danger → colour on the alert, sound/channel on the phone.
- [ ] **Alert title** (optional) → used instead of the generated title.
- [ ] The **summary line** under the form matches your choices (e.g. "Person in doorstep · entrance-1 · 22:00–06:00 · danger").
- [ ] **Untick the rule** in the list → it never alerts; tick → alerts again.
- [ ] **Delete** → confirm → gone (its old alerts stay).

### W-12 Alerts: generation, handling, who sees what
*Two windows: owner and viewer of the same org.*

1. [ ] Both windows on **Alerts**. Trigger an alert (walk past / inject).
   → In **both** windows it appears **without reloading** within ~1 s, with a toast at the bottom right.
2. [ ] Click it → snapshot **with a box around the person**, When (site time), Camera, Rule, Status **open**.
3. [ ] Viewer clicks **Acknowledge** → in the owner's window it moves to *Acknowledged* ("acknowledged Xs ago").
4. [ ] Owner adds a note "Checked, delivery" → it shows with the owner's name; the viewer sees it after refresh.
5. [ ] **Close** → *Closed*. **Reopen** → back to *Open*.
6. [ ] Filters: **Status** (Open / Acknowledged / Closed / All), **Severity**, **Camera** → the list narrows.
7. [ ] **Site-limited viewer** (`night@shop.test`): an alert at Front store **doesn't** appear for them; a Warehouse one does.
8. [ ] **Platform admin** without a grant → no alerts (W-02). With a grant → can see them but **not** acknowledge (W-16).
9. [ ] **Cooldown** (from the rule) → repeated triggers don't flood the list.

### W-13 Logging: what's recorded and who can see it
1. [ ] *As owner:* **Settings → Audit log** → each change from W-05 to W-11 is listed with **when, who, action, target**: `site.create`, `source.create`, `source.update`, `edge.create` (registered), `edge.revoke`, `camera.create/update/delete`, `zone.create/update/delete`, `line.create/update/delete`, `rule.create/update/delete`, `member.add/update/remove`, `person.create/delete`, `person.enrol_face`, `support.grant/revoke`, `org.create/update/delete`.
2. [ ] **Filter** dropdown (Support access, Cameras, Sources, Rules, Members, Edges) → narrows the list.
3. [ ] Alert handling (ack, close, notes) is recorded **on the alert itself** (who and when), not in the audit log.
4. [ ] *As admin or viewer:* no Audit log tab; opening `/api/orgs/<id>/audit` directly → **403**.
5. [ ] *As platform admin:* the Audit log tab is visible for every org.
6. [ ] **Server logs** (for you, not users): `docker compose logs -f server` shows each request; `edge` shows config syncs and event uploads; `vision` shows detections and camera ONLINE/OFFLINE. **No log line shows a password or a full `rtsp://user:pass@` URL** (go2rtc prints `***`).

### W-14 Live view
*As: anyone with footage access (Home has real cameras).*

1. [ ] Camera page → **Watch live** → **SD** plays within a few seconds; the camera's clock matches the current time.
2. [ ] **HD** → full resolution (2304×1296 on your NVR).
3. [ ] **Stop** → `http://localhost:1984` shows no viewers on that stream.
4. [ ] **Use LAN player** → go2rtc's own player (only inside your network).
5. [ ] From an alert → **Watch live** → that alert's camera.
6. [ ] A site **without a running edge** (Corner Shop) → "The site is offline." (no endless spinner).
7. [ ] Platform admin without a grant → live view refused.
8. [ ] Firefox (no H.265) → HD should fall back to the H.264 copy (**not verified yet**).

### W-15 Faces (People)
*As: owner of Home.*

1. [ ] On one camera, tick **Recognise faces** (uses the HD stream: more CPU).
2. [ ] Rule: **A face is seen** → *Unknown (couldn't confirm)* → danger.
3. [ ] Walk up to the camera facing it → alert with **"Unknown person (could not confirm)"**.
4. [ ] On that alert: **Mark as known person** → **New person…** → your name → saved.
5. [ ] Walk past again → no unknown-face alert (with a *Known person* rule: an info alert naming you).
6. [ ] **Settings → People (faces)** → you're listed with face samples; delete a sample or the person → you're unknown again.
7. [ ] Viewer: sees People but can't add or delete. Platform admin without a grant: no People.

### W-16 Support access (owner lets the platform admin see footage)
*Two windows: owner (Corner Shop or Home) and platform admin.*

1. [ ] Platform admin opens the org → Alerts says no access.
2. [ ] Owner: **Settings → Support access** → reason "Help with missing alerts", hours `1` → **Grant access** → listed as **Active** with an expiry time.
3. [ ] Platform admin reloads Alerts → **can see** alerts and snapshots; can't acknowledge.
4. [ ] Owner: **Audit log** → `support.footage_access` lines with the exact pages the platform admin opened.
5. [ ] Owner: **Revoke** → platform admin's next click → access gone immediately.
6. [ ] Grant for 1 hour and come back later → status **Expired**, no access.

### W-17 Isolation and security
1. [ ] Signed in as a Corner Shop user, paste an **Acme** or **Home** URL → sent back to your own org; no data shown.
2. [ ] Viewer: try changing things through the API (F12 → Console):
   ```js
   await fetch(location.pathname.replace(/^\/o\/([^/]+).*/, '/api/orgs/$1'), { method: 'DELETE' }).then(r => r.status)
   ```
   → **403**.
3. [ ] F12 → Network: click through Settings, Cameras, Alerts → search the responses for your NVR password or `rtsp://` → **nothing**.
4. [ ] Disabled/removed member → can't sign in to that org.

### Known gaps (not bugs in the scripts)
- No self sign-up (by design), **no "change password" or "forgot password"** yet.
- Sites can't be renamed or deleted from the UI; organizations can't be renamed or deleted from the UI (the API supports both).
- The platform admin can't acknowledge alerts even during a grant (by design: support is read-only).

---

## Part 2: Mobile app (Android)

The app is for **alerts, push notifications and live view**. Configuration (sites, cameras, rules,
members) is web-only.

### Setup
- Install the APK from the EAS build link (Android asks to allow installs from Chrome: allow it).
- Phone on the **same Wi-Fi** as the PC. First open `http://192.168.1.33:5173` in the phone's Chrome; the sign-in page must load.

### M-01 Sign in
1. [ ] Open **Vigil** → the sign-in screen: Server address, Email, Password.
2. [ ] Server `http://192.168.1.33:5173`, a **wrong password** → a readable error, no crash.
3. [ ] **Wrong address** (e.g. `http://192.168.1.99:5173`) → an error after a few seconds, no crash.
4. [ ] Correct details → **Sign in** → Android asks to **allow notifications** → **Allow**.
   → The alerts screen, titled with your **organization's name**, and a line **"Push notifications on"**.
   If it shows "Notifications are switched off for this app", push won't work: allow it in Android Settings → Apps → Vigil.
5. [ ] Swipe the app away and reopen → still signed in.

### M-02 Each role on the phone
| Sign in as | → Expected |
| --- | --- |
| Owner / Admin / Viewer | Same screens: alert list, detail, acknowledge, close, notes, live view. (Roles only differ in the web app's configuration screens.) |
| Site-limited viewer (`night@shop.test`) | Only Warehouse alerts in the list **and in push**. |
| A user in **two orgs** | *Gap:* the app shows only the **first** organization (no org switcher yet). |
| Platform admin who isn't a member | *Gap:* nothing useful (no org). Expected: platform admins use the web. |

### M-03 Alert list
1. [ ] **Open** / **All** filters.
2. [ ] Trigger an alert with the app open → it appears **within ~15 s** by itself.
3. [ ] **Pull down** → refreshes immediately.
4. [ ] Each row: coloured bar (red danger / amber warning / blue info), title, "severity · x min ago · status".

### M-04 Alert detail
1. [ ] Tap an alert → title, time, **snapshot** (loads with your session; an expired session = no image), "Camera … · Rule …".
2. [ ] **Acknowledge** → status "acked"; the web shows it acknowledged by you.
3. [ ] **Add a note** → it shows with your name; also visible on the web.
4. [ ] **Close** → "closed"; the button becomes **Reopen** → tap it → open again.
5. [ ] Face alerts → "Known person" (green) or "Unknown person" (red).

### M-05 Push notifications
1. [ ] **Background:** press Home, trigger an alert → a notification within a few seconds, e.g. "🚨 Person in doorstep · Entrance" / "Camera entrance-1".
2. [ ] **Tap it** → the app opens **on that alert**.
3. [ ] **App closed** (swipe it away from recents), trigger → notification; tap → opens that alert.
4. [ ] **Phone locked** → shows on the lock screen.
5. [ ] **App open** → a banner at the top as well.
6. [ ] **Severity:** danger alerts use the louder **"Danger alerts"** channel; others use **"Alerts"**. Android Settings → Apps → Vigil → Notifications lists both, adjustable separately.
7. [ ] **Two phones / web + phone:** acknowledging on one doesn't stop the push on others (each alert pushes once).
8. [ ] **Rule cooldown** → no repeated pushes within the cooldown.

### M-06 Live view
1. [ ] Alert → **Watch live** → video within a few seconds (same Wi-Fi). Header: camera name, **SD/HD** toggle.
2. [ ] **HD** → sharper, may take a moment longer.
3. [ ] **Back** → the stream stops (go2rtc's page shows no viewer).
4. [ ] A site with no edge → "The site is offline."
5. [ ] **On mobile data:** expected to **fail** for now (needs Tailscale or the TURN relay on a public hub).

### M-07 Sign out and switching users
1. [ ] **Sign out** (top right) → the sign-in screen.
2. [ ] Trigger an alert → **no** notification on this phone.
3. [ ] Sign in as a **different** user → only their org's alerts and pushes.

### M-08 Resilience
1. [ ] In WSL: `docker compose stop server` → pull to refresh shows an error, no crash. `docker compose start server` → refresh works.
2. [ ] Airplane mode on → error on refresh; off → works again.
3. [ ] The PC's Wi-Fi address changed (router restart) → the app can't connect; sign out and in with the new address. (Better: reserve a fixed address for the PC in the router.)

---

## Part 3: Server, edge and vision (behind the scenes)

Keep `docker compose logs -f server edge vision` open in a WSL window (Ctrl+C stops watching).

1. [ ] **Health:** `http://localhost:5173/api/health` → OK.
2. [ ] **Config push:** change a zone in the web → the edge log shows the change **within seconds** (control channel), not after a polling wait.
3. [ ] **Hot reload:** change one camera's settings → vision restarts **only that camera**.
4. [ ] **Camera offline/online:** untick Enabled (or unplug the camera at the NVR) → vision says "camera OFFLINE", the dashboard shows Offline, a Camera-offline rule alerts. Re-enable → "camera ONLINE".
5. [ ] **Events survive a server outage:** `docker compose stop server` → walk past a camera → wait a minute → `docker compose start server` → the alert still arrives (the edge kept it on disk and sent it later).
6. [ ] **Edge down:** `docker compose stop edge` → after ~1–2 min the dashboard says the edge isn't seen; live view says the site is offline. `docker compose start edge` → recovers.
7. [ ] **Real walk test:** walk past each Home camera once → one alert per pass (no duplicates). Note misses and false alarms (e.g. the 0.41 box at the entrance).
8. [ ] **Night:** repeat after dark (infrared) and note the quality.
9. [ ] **NVR lockout guard:** don't test on your real NVR (Dahua locks the account after a few bad logins). It's covered by unit tests.
10. [ ] **Not testable here yet:** TURN relaying and live view from outside your network (needs a public hub).

---

## After testing
- [ ] Remove test orgs you don't want: as their owner, there's no UI yet. Ask me, or leave them; they don't alert without an edge.
- [ ] `npm run e2e -w apps/server -- reset` removes the Acme demo org and its users.
- [ ] Remove test zones/rules from **Home** so they don't keep alerting.
- [ ] Delete `data/.env.before-b6` (an old backup with the NVR password).
