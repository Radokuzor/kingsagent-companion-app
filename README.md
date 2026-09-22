# Kings Agent — Android build

This branch holds **only the built APK**. The source lives on `main`.

## Install it

**[⬇ Download kings-agent.apk](https://github.com/Radokuzor/kingsagent-companion-app/raw/release/kings-agent.apk)**

Open that link on the phone, tap the download, then open it. Android will ask
you to allow installing from your browser the first time — that is expected
for an app that does not come from the Play Store.

## Then, in this order

1. **Sign in with KingsChat.** The app opens KingsChat's own sign-in page in
   your browser. Approve it, then return to the app — it picks up your account
   by itself. Nothing to type, no codes to copy.
2. **Settings → Alarm permissions.** Four switches decide whether an alarm
   really rings. Turn on any that show *Fix*, especially **Full screen alarms**
   — on Android 14 and up an app does not get that automatically, and without
   it an alarm appears as a quiet banner instead of taking over the screen.
3. **Alarms → Test alarm in 20 seconds.** Then lock the phone and let the
   screen go dark. Unlocked, Android deliberately shows a notification instead,
   so an unlocked test proves nothing.
4. **The real test.** DM the bot on KingsChat: *"remind me to call Mum in 2
   minutes"*. Lock the phone, put it in airplane mode, and leave it. It should
   ring on time, full screen, until dismissed.

Step 4 is the whole point of this app. Once the phone has synced a reminder
even once, the alarm is held by Android's own alarm clock — it fires with no
network, with the app closed, and after a reboot.

## What this build is

- Package `com.kingschat.kingsagent`, version 1.0.0, release build.
- Signed with the Kings Agent release key
  (`SHA-1 C8:10:B5:C3:F5:EF:BA:8E:85:64:1F:DD:5C:1B:94:8A:17:EE:3B:A7`).
  A later version installs over this one only if it carries the same key.
- Firebase project `kings-agent`, so push nudges work.

## If sign-in fails

The app talks to the backend at `kcagent.up.railway.app`. This build needs the
`companion-app-phase1` changes deployed there — until that is merged and live,
sign-in will not complete.
