# Kings Agent — Android build

This branch holds **only the built APK**. The source lives on `main`.

## Install it

**[⬇ Download kings-agent.apk](https://github.com/Radokuzor/kingsagent-companion-app/raw/release/kings-agent.apk)**

Open that link on the phone, tap the download, then open it. Android will ask
you to allow installing from your browser the first time — that is expected
for an app that does not come from the Play Store.

## Then, in this order

1. **Sign in with KingsChat.** KingsChat's own sign-in opens inside the app.
   Approve it and the sheet closes by itself — you never leave the app, and
   there is nothing to type and no code to copy.
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

- Package `com.kingschat.kingsagent`, version **1.2.4** (versionCode 8),
  release build.
- Signed with the Kings Agent release key
  (`SHA-1 C8:10:B5:C3:F5:EF:BA:8E:85:64:1F:DD:5C:1B:94:8A:17:EE:3B:A7`).
  A later version installs over this one only if it carries the same key.
- Firebase project `kings-agent`, so push nudges work.

## New in 1.2.4

**Your pictures and clips show up.** The agent has been saving them all
along — ask it for an image, or send it a photo, and it files one away — but
this app only ever recognised a picture, never a clip, and it worked that out
partly from the file extension. Media saved by the agent has no extension to
read: the link is a short `/l/<code>` redirect, and the title is a name
("Holographic Objects"), not a filename. So a video sat under **Documents**,
and tapping one opened a blank image viewer instead of playing it. Both now
go by what the item actually is. Videos open in your own player; pictures
open in the viewer as before.

**A photo or clip you send the agent is now kept.** Sending one used to do
nothing at all — no reply, and nothing saved, so you could not ask for it
again later. It is now saved to your media the moment it arrives, with a
short link back to it, alongside anything the agent made for you. This half
is a backend change: it is live already, and works with this build and the
last one.

The earlier 1.2.x work is included: a failed alarm reports itself, repeating
reminders survive being dismissed, the Home section, the single Alarms list,
and sign-in that stays inside the app.

## If sign-in fails

The app talks to the backend at `kcagent.up.railway.app`, and it needs the
current backend deployed there. If sign-in hangs or reminders never sync,
check that the deploy is up to date before looking at the phone.
