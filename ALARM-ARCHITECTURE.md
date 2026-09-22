# Alarm delivery architecture, and why Firebase alone cannot wake a phone

**Question this answers (Radiance, 22 Sep 2026):** if the agent writes a reminder into the user's Firebase
account and the app picks it up in the background, will it still arm an alarm and fire if the user has not
opened the app for a long time?

**Answer: no, not reliably.** Details below, all from Android's own documentation.

---

## 1. The two things that break Firebase-as-the-trigger

### 1a. A Firestore listener cannot wake an app. It only runs while the app is already alive.
A realtime listener is a live connection held by the app's own process. When Android kills that process
(minutes to hours after the app goes to the background), the listener dies with it. Firestore has no
ability to start your app. So "the app is watching Firebase in the background" is true for a few minutes
and false after that.

### 1b. Only a high-priority FCM message can wake it, and rarely used apps stop getting those.
From *App Standby Buckets*: on Android 13+, the system moves an app into the **restricted** bucket after
just **8 days** without user interaction (45 days on Android 12), unless it qualifies for an exemption. In
the restricted bucket:

> Your app can invoke **one alarm per day**. This alarm can be either an exact alarm or an inexact alarm.

And from *Optimize for Doze and App Standby*: while the device is in Doze, **network access is suspended**
and standard alarms are deferred to the next maintenance window, so the Firestore read does not happen on
time either.

**Consequence:** a user with five reminders who has not opened the app in a week can only get one alarm a
day. That is the failure mode you were asking about, and it is real.

---

## 2. The good news: this app is already exempt from the restricted bucket

The same page lists who bypasses that inactivity trigger:

> Apps that are granted at least one of the following permissions:
> **USE_EXACT_ALARM** / ACCESS_BACKGROUND_LOCATION

`app.json` already declares **`USE_EXACT_ALARM`** (plus `SCHEDULE_EXACT_ALARM` and
`RECEIVE_BOOT_COMPLETED`). So the app is exempt from entering the restricted bucket and bypasses the 8-day
inactivity trigger. **Do not remove that permission.** It is the single most important line in the manifest
for this product, and it was put there for the right reason by accident.

Caveat for later: Google Play restricts *who may declare* `USE_EXACT_ALARM` to apps whose core function is
an alarm clock or calendar. This app plausibly qualifies, but it is a review risk worth knowing before any
Play Store submission. Sideloaded APKs are unaffected.

---

## 3. The design rule that follows

**The device owns the schedule. The server only sends changes.**

1. **Source of truth:** `users/{kcId}/reminders/**` in Firestore, so the agent, the app, and the web all see
   the same list.
2. **Local mirror:** the same jobs also live on the device. The device computes the next occurrence and arms
   it with the AlarmManager. Once armed, the alarm fires with no network, no server, and the app closed.
3. **Reconcile on every opportunity the app is running anyway:** app launch, app resume, and every time an
   alarm fires (the app is started by the OS to handle it). Push is a latency optimisation, never the
   mechanism.
4. **So the agent's reliability equals one successful delivery.** After a single sync, the job is local and
   durable. Say that plainly to users instead of promising instant push.

## 4. The alarm calls, strongest first

From *Optimize for Doze and App Standby*:

| Call | Behaviour in Doze |
|---|---|
| `setExact()`, `setWindow()` | **Deferred** to the next maintenance window |
| `setExactAndAllowWhileIdle()` | Fires in Doze |
| **`setAlarmClock()`** | **"Continue to fire normally. The system exits Doze shortly before those alarms fire."** |

For a genuinely *ringing* alarm (v3 of the roadmap) `setAlarmClock()` plus a foreground service for the
full-screen ringing UI is the correct target. `expo-notifications` is fine for v1, but if the ringing must be
an alarm clock rather than a notification, expect a small native module.

## 5. Actions this implies for the app

- Keep `USE_EXACT_ALARM`. Never drop it.
- `expo-notifications` already re-arms scheduled notifications at boot via `RECEIVE_BOOT_COMPLETED`
  (confirmed in the Android section of the SDK 57 notifications docs).
- Prompt for the battery-optimisation exemption during sign-in. Google's own table lists
  **"Task automation app: core function is scheduling automated actions"** as an *acceptable* use case for
  `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.
- The agent-to-phone path needs **FCM**, which does **not** work in Expo Go. That half of the product cannot
  be tested until there is a real build. Local alarms can be fully tested in Expo Go today.
- Send high-priority FCM only for messages that produce a visible notification. Marking non-user-facing
  messages high priority gets future messages deprioritised.

## 6. Sources

- App Standby Buckets: https://developer.android.com/topic/performance/appstandby
- Doze and App Standby: https://developer.android.com/training/monitoring-device-state/doze-standby
- expo-notifications (SDK 57): https://docs.expo.dev/versions/v57.0.0/sdk/notifications/
