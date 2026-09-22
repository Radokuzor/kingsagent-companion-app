# Kings Agent — companion app (build brief)

> Paste this into Claude Code, or copy it over the template's placeholder:
> `cp BUILD-BRIEF.md CLAUDE.md` (that has to be your move — the tool blocks me from writing CLAUDE.md itself).

## What this is
Android companion for the KingsChat agent. Two jobs, nothing else:

1. Show the site people already use — `https://kingsagent.gildsociety.com` — as a real app.
2. Receive **programmable instructions from the agent** and execute them on the device as **real alarms**.

## Seeing it work WITHOUT a phone (Mac preview)
`npx expo start --web` runs the real app in Safari at `http://localhost:8081`. Useful for fast UI iteration
with Claude Code. Needs `react-dom` + `react-native-web` (already installed).

Two things do NOT work in the web preview, and both are expected, not bugs:
- **The App tab shows `React Native WebView does not support this platform.`**
  `react-native-webview` has no web implementation. The WebView only exists on a real device.
- **Notifications are a no-op.** Expo logs `[expo-notifications] Listening to push token changes is not yet
  fully supported on web`. So the alarm can never be proven in the browser. It has to be the phone.

Verified live on the Mac preview 2026-09-22: all three tabs render, the tab switcher works, and the app
generates and persists a real device id (`dev_lc13cjia2zx0`).

## Getting it onto the Android phone
1. Install **Expo Go** from the Play Store.
2. Phone and Mac on the same Wi-Fi. The Mac is `192.168.10.115`.
3. In Terminal: `cd ~/Documents/companion-app && npx expo start`, then scan the QR with Expo Go.
4. If the phone cannot see the Mac (some routers isolate clients): `npx expo start --tunnel`.
5. Only ever run ONE dev server at a time. Two Metro instances will fight over port 8081 and this Mac has 8 GB.
6. The proof that matters: **Alarms tab → Test alarm in 20 seconds → lock the phone → it should ring.**

## Building the installable APK (EAS cloud, no local SDK needed)
There is no JDK or Android SDK on this Mac, so `npm run android` and `npx expo run:android` cannot work.
The APK is built in Expo's cloud.

- **Expo account:** `king_kuz`
- **EAS project:** `@king_kuz/kings-agent`
- **projectId:** `39e34497-8899-410f-9745-e2cf912c6ccb` (stored in `app.json` -> `expo.extra.eas.projectId`)
- **Dashboard:** https://expo.dev/accounts/king_kuz/projects/kings-agent

```
cd ~/Documents/companion-app
npx eas-cli@latest build -p android --profile preview
```

`preview` = `buildType: apk` + `distribution: internal`, standalone, so it runs with no dev server.
`production` = `.aab` for the Play Store. Never use `development` for something you hand out; it needs Metro.

Two things that bite:
- The **keystore** EAS generates is the only thing that lets a later version install over the old one.
  Do not delete it from the Expo dashboard.
- The **package name** (`com.kingschat.kingsagent`) is permanent. Change it later and Android treats it as a
  brand new app, so every user has to uninstall and reinstall. Decide it before distributing.

## The one design rule (do not break it)
**Never design "server pushes, phone rings."** FCM/APNs are best-effort, delayed by Doze and dropped offline.
The reminder registers a **local alarm on the device at creation time**. Push is only sync and fallback.
That is why the app exists: it rings with no internet, in airplane mode, with our server down.

## Stack and commands
Expo SDK 57 / React Native 0.86 / TypeScript. This Mac has **no JDK, no Android Studio, no Android SDK** — do not
try to build locally.

```
npm start              # npx expo start — scan the QR with Expo Go on the Android phone
npx tsc --noEmit       # typecheck (must be clean)
npx expo lint          # lint
```

- Local notifications **work** in Expo Go.
- Remote push does **not** work in Expo Go (removed on Android in SDK 53+). Push needs a dev build.
- Installable APK later, cloud-built: `npx eas-cli@latest build -p android --profile preview`
- Android exact alarms need `SCHEDULE_EXACT_ALARM` — already set in `app.json`. Keep it there.

## Files
| File | Role |
|---|---|
| `App.tsx` | 3 tabs: **App** (WebView), **Alarms** (armed list + settings), **Arm** (paste an instruction) |
| `src/instructions.ts` | The envelope, the parser, the scheduler, the permission asks |
| `src/store.ts` | AsyncStorage persistence, device id, dedupe helper |

## The contract — the agent's side of this app
The agent sends this JSON. Same `id` twice is armed once. Unknown fields are ignored.

```json
{
  "instructions": [
    {
      "id": "rem_20260922_1400",
      "type": "reminder",
      "title": "Workout",
      "body": "Legs day. 45 minutes.",
      "at": "2026-09-22T14:00:00+01:00",
      "repeat": "weekdays",
      "data": { "from": "kingschat" }
    }
  ]
}
```

- `type`: `reminder` | `task` | `command`
- `at`: ISO 8601 **with offset** (`+01:00` for Lagos). Required for `reminder`.
- `repeat`: `none` | `daily` | `weekdays` | `weekly`
- `data`: free-form, passed through to the notification payload

A single object or a bare array is also accepted. Do not change these names.

## Scope for v1 — do NOT add these
- No chat client. KingsChat stays the conversation surface.
- No login / OAuth / Supabase / Firebase SDK in the app.
- No expo-router — v1 uses a hand-rolled 3-tab switcher on purpose (fewer moving parts, 2-hour build).
- No server code in this repo. No app store submission. No state library.

## After v1 works, in this order
1. Deep link: the agent DMs `kingsagent://arm?d=<base64 instruction json>` and tapping it arms directly.
2. Pairing: show the device id in the app; the agent writes `users/{kcId}/devices/{deviceId}` in Firestore.
3. Feed URL: point `Settings → Instruction feed URL` at a real endpoint (or Firestore REST).
4. EAS dev build + FCM — for **sync only**. Alarms stay local.

## Definition of done for any change
- `npx tsc --noEmit` is clean.
- The test alarm rings with the phone **locked** and in **airplane mode**.
- A past `at` time is rejected, not silently scheduled.
- A duplicate `id` does not create a second alarm.
