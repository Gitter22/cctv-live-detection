# Mobile app: build, install, push

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
