# E2E report (phase G)

**Date:** 2026-11-22 · **Browser:** Chrome (Windows) driven by Claude in Chrome · **Stack:** full Docker Compose (`server` + `edge` profiles) on WSL2, web at `http://localhost:5173` (nginx → server).

**Fixtures (G1):**
- `npm run e2e -w apps/server -- seed` creates the org `acme-e2e` with site "Plant 1", cameras `gate-1` and `press-3`, two rules, and an owner, admin and viewer user.
- It also creates a viewer of the real **home** org (`home-viewer@e2e.test`).
- Passwords are in `data/e2e-credentials.json` (gitignored).
- Acme has no real edge; its events come from the injector (`… -- event <camera> <type> [zone]`), which posts through the real edge API with the edge token.
- The home org is the real setup: Dahua NVR → go2rtc → vision → edge.

Screenshots are in [`e2e/`](e2e/). The home-camera screenshots aren't committed, for privacy.

## Results

### G2: admin and config flows: **pass**

| Step | Result |
| --- | --- |
| Admin signs in, sees only their org and its dashboard | ✅ [g2-01](e2e/g2-01-admin-dashboard.jpg) |
| Add camera `dock-5` with its own RTSP URL containing a canary password | ✅ 201. The list shows "Own URL" ([g2-02](e2e/g2-02-camera-added.jpg)). The API returns only `subUrlSet: true`; the DB column holds `v1:…` ciphertext with no plaintext |
| Draw a zone on the camera (click corners, Enter), rename it, save | ✅ 201, key `dock-apron` ([g2-03](e2e/g2-03-zone-saved.jpg)) |
| New rule: specific camera `dock-5`, presence in `dock-apron`, danger, cooldown 0 | ✅ The zone list narrows to the chosen camera. The plain-English summary reads "Person in dock-apron · dock-5 · always · danger" ([g2-04](e2e/g2-04-rule-form.jpg), [g2-05](e2e/g2-05-rules-list.jpg)) |
| Add an NVR source (Dahua) with a canary password | ✅ Shown as "e2eview · password set" ([g2-06](e2e/g2-06-source-password-set.jpg)) |
| Super admin creates an org with a new owner | ✅ via the API (201). The new owner signs in and sees only that org. Done with curl so the real super admin password never went into the browser. Test org removed afterwards |
| Every change is in the owner's audit log (`camera.create`, `zone.create`, `rule.create`, `source.create`) | ✅ |
| Edge picks up config changes | Not re-run here: Acme has no real edge. It was verified in F1, where a config push reached the edge in 0.2 s |

### G3: alert flows and live view: **pass**

| Step | Result |
| --- | --- |
| Injected `zone.enter` on `dock-5` → alert from the rule created in G2 | ✅ It appeared on the open Alerts page without a reload: toast, snapshot with bounding box, "0s ago" ([g3-01](e2e/g3-01-live-alert-toast.jpg)) |
| Acknowledge → add note → close → shows under Closed with note and author | ✅ ([g3-02](e2e/g3-02-acked-with-note.jpg)) |
| Real events from the home cameras → alerts | ✅ The home org has live alerts from the real pipeline (entrance, minutes old) |
| **Live view, SD (WebRTC through the server)** | ✅ `<video>` playing at 640×360, 83 frames decoded in 8 s, camera clock overlay matches the current time |
| **Live view, HD** | ✅ 2304×1296 playing, 219 frames, 7 dropped. Chrome on this PC offers H.265 over WebRTC, so go2rtc sent the main stream directly; the `_h264` fallback wasn't needed |
| Live view on a site without an edge | ✅ Clear message "The site is offline." ([g3-03](e2e/g3-03-live-site-offline.jpg)) |
| Browser console | ✅ No errors or warnings during dashboard → alerts → live view |

### G4: security flows: **pass**

| Attempt | Expected | Result |
| --- | --- | --- |
| Viewer: create, edit or delete a camera; create or edit a rule; add a source; add a member (direct API calls) | 403 | ✅ All 403. The UI hides those buttons ([g4-01](e2e/g4-01-viewer-read-only.jpg)) |
| Viewer: acknowledge an alert, open live view | allowed (viewers manage alerts by design) | ✅ 200 |
| Admin: read the audit log or support grants | 403 (owner only) | ✅ 403 |
| Acme viewer → home org: org, sites, cameras, alerts, an alert, snapshot, live, SSE stream | denied, without revealing that it exists | ✅ All **404** |
| ID swap: home site, camera, alert or event under the Acme org path (read, ack, snapshot, live) | 404 | ✅ All 404 |
| Positive control: Acme's own alert and snapshot | 200 | ✅ 200, `image/jpeg` |
| Platform admin, **no grant**: org, sites, cameras (config) | 200 | ✅ |
| Platform admin, **no grant**: alerts, snapshot, live | 403 | ✅ 403 |
| Owner grants 1 h support access → platform admin retries | 200, audited | ✅ 200. The audit log shows two `support.footage_access` entries with the exact paths ([g4-02](e2e/g4-02-support-grant-active.jpg)) |
| Owner revokes → platform admin retries | 403 immediately | ✅ 403 ([g4-03](e2e/g4-03-support-grant-revoked.jpg)) |
| Canary passwords (camera URL, NVR source) in **any** API response: me, orgs, sites, sources, cameras, edges, rules, alerts, members, people, audit, live, including the platform admin's config view | never | ✅ None found. The live-view response has only `webrtc`, `sd`, `hd` and no stream URLs |
| `/edge/v1/config` without an edge token, or with a forged one | 401 | ✅ 401. Only the site's edge gets decrypted URLs |

## Bugs found and fixed

1. **Sign out didn't leave the app.**
   - **Symptom:** `POST /auth/logout` succeeded (204), but the page kept showing the signed-in layout until a reload. Anything typed afterwards went into a stale page.
   - **Cause:** `qc.clear()` removed the `me` query that `useQuery` was subscribed to, so the following `setQueryData(['me'], null)` created a new query nobody observed.
   - **Fix:** `resetSession()` in `apps/web/src/auth/auth.tsx` sets `me` to null in place, then removes only the other queries. A unit test using a `QueryObserver` covers it. Verified in Chrome: Sign out → login page ([g4-04](e2e/g4-04-signout-fixed.jpg)).
2. **Dead end after switching accounts.**
   - **Symptom:** after a sign-in, the app returns to the previous page. If that page belonged to another user's org, the new user saw "Organization not found." with no navigation.
   - **Fix:** `OrgLayout` redirects to `/` (the user's first org) on 403 or 404. Other errors show a "Go home" link. Verified: the home viewer opening the Acme URL lands on their Home dashboard.

## Observations (not changed)

- **Viewers can see the NVR's LAN IP and username** on the Sources list (never the password). This follows `config.read`. If viewers shouldn't see infrastructure details, restrict `GET …/sources` to admins.
- **NVR read timeouts:** go2rtc logs `i/o timeout` from the NVR roughly every 1–2 minutes on the sub streams. Once (03:37:58) the main and sub streams dropped together, and vision marked `entrance-1` offline for about 30 s before it recovered by itself. Started live view doesn't cause it: the timeouts appear before any viewer connects. Most likely Wi-Fi or NVR load; worth checking the NVR's network link.
- **Possible false positive:** a home alert at 09:17:42 had a small "person" box (confidence 0.41) near the top of the entrance frame. If it repeats, raise that camera's confidence threshold or add a zone that excludes that area.
- Acknowledging an alert while the filter is "Open" moves the selection to the next alert. That's expected, but switch to **Acknowledged** to add a note.

## Not covered here

- **Phone:** push notifications, live view in the app and APK install (F6–F8) need your phone; see `docs/MOBILE.md`.
- **TURN relaying** across networks needs a hub with a public IP. Locally, only credential issuing and refusal were checked.
- **The `_h264` live fallback** on a browser without H.265 support (for example Firefox).
