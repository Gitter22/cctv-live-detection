# Vigil mobile app: build, install, push

`apps/mobile` is an Expo (SDK 58) app with **its own npm install** (Expo needs React 19.3.0 exactly; the web uses 19.3.1). The steps below need you (an Expo account and your phone). Everything else is ready.

## 0. Try it without building (Expo Go)

1. On the phone, install **Expo Go** from the Play Store.
2. On the laptop:
   ```bash
   cd apps/mobile
   npx expo start
   ```
3. Scan the QR code with Expo Go. The phone must be on the **same Wi-Fi** as the laptop.
4. Sign in. For **Server address**, use the laptop's LAN address, e.g. `http://192.168.1.x:5173` (find it with `ipconfig` in Windows PowerShell, under your Wi-Fi adapter's "IPv4 Address").

Login, alerts and alert actions work in Expo Go. Push notifications don't (step 2 needs a build).

## 1. One-time Expo setup

```bash
npm install -g eas-cli
cd apps/mobile
eas login          # free account at expo.dev
eas init           # creates the project and writes extra.eas.projectId into app.json
```

`eas init` also enables push notifications: the app needs that project ID to get a push token.

## 2. Build the APK (cloud, free tier)

```bash
cd apps/mobile
eas build --platform android --profile preview
```

- It takes about 10 to 20 minutes on Expo's servers and ends with a **download link**.
- On the phone, open the link and install it. Allow "install unknown apps" for your browser when Android asks.
- For push on Android, EAS asks to set up **FCM** credentials the first time. Choose "Let EAS handle it" (it guides you through creating a Firebase project with the free plan).

## 3. Check it works (plan tasks F6–F8)

| Check | How |
| --- | --- |
| **F8** APK installed | The app opens and you can sign in with the server address |
| **F6** push | Sign in once (the app registers the phone), lock it, then walk past the entrance camera (or ask me to inject a test event): a notification arrives. Tapping it opens the alert |
| **F7** live view | Open an alert → **Watch live**. On the same Wi-Fi it should play within a few seconds |

## Notes

- **Plain http on the LAN:** the APK allows `http://` (`usesCleartextTraffic`), because the server has no TLS on the LAN or Tailscale. When the hub gets a public HTTPS address, remove that setting from `app.json`.
- **Live view away from home** needs the site's go2rtc to be reachable (Tailscale, or the TURN relay on a public hub: see `.env.example`, `turn` profile).
- **The session** is stored in Android's encrypted Keystore (expo-secure-store). Signing out deletes it and unregisters push on the server side when the token stops being valid.

## Automated tests (Android emulator + Maestro)

`npm run e2e:mobile` signs in, receives an injected alert, acknowledges, adds a note and closes it,
gets a **push notification** with the app in the background and opens the alert from it, checks live
view, signs out (and checks the push token was unregistered), then watches a real camera as the home
viewer. Flows: `apps/mobile/e2e/flows/*.yaml`; runner: `apps/mobile/e2e/run.sh`.

### One-time setup (Windows)

Everything lives on `D:\Android` (C: stays free):

1. **Android Studio** installed to `D:\Android\Android Studio`, SDK at `D:\Android\Sdk` (custom install).
   User environment variables: `ANDROID_AVD_HOME=D:\Android\avd`, `GRADLE_USER_HOME=D:\Android\gradle`.
2. **Emulator:** Device Manager → Pixel 7, system image with **Google Play** (push needs Play services;
   "Google APIs" / AOSP images don't get pushes). RAM 4 GB, graphics Hardware.
3. **Maestro** unzipped to `D:\Android\maestro` (from its GitHub releases), plus the launcher
   `D:\Android\maestro-run.cmd`, which uses Android Studio's bundled Java:
   ```bat
   @echo off
   set "JAVA_HOME=D:\Android\Android Studio\jbr"
   set "PATH=D:\Android\Sdk\platform-tools;%JAVA_HOME%\bin;%PATH%"
   set MAESTRO_CLI_NO_ANALYTICS=1
   call "D:\Android\maestro\bin\maestro.bat" %*
   ```

Maestro runs on Windows because WSL's NAT network can't reach the Windows adb server. Other paths can
be set with `ADB`, `MAESTRO_CMD`, `E2E_WORKDIR_WIN` and `E2E_APP_SERVER`.

### Run

1. Start the stack (`docker compose up -d`) and the emulator (Device Manager → ▶).
2. `npm run e2e:mobile -- path/to/vigil.apk` the first time (installs it), then `npm run e2e:mobile`.

The runner re-seeds the E2E fixtures (`data/e2e-credentials.json`), so test passwords rotate each run.
Screenshots go to `D:\Android\vigil-e2e\screens` (outside the repo: the real-camera ones show your site).
Inside the emulator the server is `http://10.0.2.2:5173`: `10.0.2.2` is the emulator's name for the PC.
