# Kings Agent — companion app (build brief)

> Supersedes the original WebView-era brief. What this file described before —
> a WebView tab showing the website, a paste-an-instruction tab, a kcId typed
> or scraped out of the site's session, Expo Go, EAS cloud builds from a Mac —
> is **gone**. Do not reintroduce any of it.

## What this is

The **execution surface** for the Kings Agent bot. A KingsChat user asks the
bot for a reminder; this app rings their phone like an alarm clock — offline,
with the app closed, after a reboot. That is the one thing a chat bot
fundamentally cannot do, and it is the entire reason this app exists.

It is a **native client of the Kings Agent backend**, not a browser for the
website. Three tabs behind a KingsChat sign-in: **Home**, **Alarms**,
**Settings**.

- **Home** is the person's own space, read from
  `GET /api/agent-connect/my-data?messages=0`: their profile, and a nav list
  into their documents, media, contacts, notes & to-dos and scheduled sends —
  everything the website's `/me` page shows. Contacts can be added here, with
  the KingsChat handle looked up as it is typed, and the same hard rule the
  backend enforces everywhere else: a name **and** a handle, or no save.
  The **chat history is deliberately not mirrored** — the conversation lives in
  KingsChat, where they had it, and a second copy of it here would earn
  nothing.
- **Alarms** is one list of what is armed on this phone. There is no
  "from your agent" / "your own" split: an alarm rings the same way and is
  removed the same way whichever end set it, and the only code that still cares
  is `remove`, which cancels a server reminder on the server too. Setting one
  is behind the **+** button, so the screen shows alarms and nothing else.
- **Settings** is the account, the four Android gates, push status, the test
  alarm (it belongs beside the permissions it exists to prove) and sign out.

## The one design rule

**The device owns the schedule. The server only sends changes.**

Firestore holds the truth about a reminder. The phone mirrors it and arms its
own `AlarmManager.setAlarmClock()` alarm, which then fires with no network, no
server and the app closed. Push (FCM) is *only* a nudge to sync sooner — never
the mechanism. So agent reliability equals **one successful sync**; say that to
users rather than promising instant push.

Corollary, and the reason `USE_EXACT_ALARM` must never leave the manifest: it
is what exempts this app from Android's **restricted** standby bucket, where an
app unopened for 8 days may fire only one alarm per day.

## How signing in works

KingsChat locks a developer project's redirect URL to the website's
`/auth/callback` and it cannot be repointed at a phone, so the app cannot catch
the authorization code. It is brokered by the backend instead:

1. `POST /api/auth/app-pair/start {device_id}` → `{pair_id, secret, consent_url}`
2. The app opens `consent_url` in a **Chrome Custom Tab** — KingsChat's own
   sign-in, via the website's `/app-login`. Only the pairing id is in the URL.
   We never see anyone's password and never render a login form.
3. The website finishes the exchange and binds the account to the pairing.
4. The app polls `POST /api/auth/app-pair/claim {pair_id, secret}` and receives
   `{token, refresh_token, user, kcId}` over TLS. The secret never entered a URL.

That consent is also **authorisation**: KingsChat's developer API refuses to
deliver to, or send as, anyone who has not consented to this project. Signing
in here is what makes "the bot can DM you" true.

The **kcId is plumbing** — it is stored, never displayed, never logged, never
put in a URL. The person sees their KingsChat name.

## Building it (locally, no Expo Go, no EAS)

This machine has a JDK at `~/.jdks/temurin-17` and the Android SDK at
`~/Android/Sdk` (platform 36, build-tools 36, platform-tools). The system
`java-21-openjdk` is a **JRE with no compiler** — pointing Gradle at it fails
with `does not provide the required capabilities: [JAVA_COMPILER]`.

```bash
export JAVA_HOME="$HOME/.jdks/temurin-17"
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

npx tsc --noEmit                      # must be clean
cd android && ./gradlew assembleDebug # -> app/build/outputs/apk/debug/
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`android/` is generated and gitignored. **After any `npx expo prebuild`**, run
`bash scripts/restore-native-patches.sh` — prebuild silently deletes the five
alarm components, the four extra permissions, the uncompressed alarm sound, the
signing config and `MainApplication.kt`'s `AlarmPackage()` registration. That
last one is the dangerous loss: the app still builds and runs, it just quietly
stops being a real alarm. The script re-checks all of it and fails loudly.

FCM needs a real `google-services.json` — see `PLACEHOLDER-google-services.md`.

## Files

| File | Role |
|---|---|
| `App.tsx` | Boot, session, the Home/Alarms/Settings tabs (Home owns a small sub-route stack the hardware back button pops), and the sync triggers (launch, resume, push). |
| `src/SignInScreen.tsx` | The Custom Tab pairing flow. |
| `src/HomeScreen.tsx` | The personal space: profile header, nav list, and the `my-data` fetch its sub-screens are fed from. |
| `src/DocumentsScreen.tsx` | Research, reports and received files. Every document is a hosted link, so it opens externally. |
| `src/MediaScreen.tsx` | Pictures and video, as a grid. Thumbnails load from the short link, which signs a fresh URL per hit — nothing caches a resolved address. |
| `src/ContactsScreen.tsx` | The address book, and the add form: handle lookup, name, how to address them, how you talk to them. |
| `src/ListsScreen.tsx` | Notes and to-dos, read-only — they are written by talking to the agent. |
| `src/ScheduledScreen.tsx` | Queued sends. `needs_action` means the agent is waiting on a reply in the DM. |
| `src/AlarmsScreen.tsx` | One list of armed alarms, add via the + sheet, remove. |
| `src/SettingsScreen.tsx` | Account, the four Android alarm gates, the test alarm, push status, sign out. |
| `src/session.ts` | The session, in **expo-secure-store** — never AsyncStorage. |
| `src/api.ts` | The one backend client. One silent refresh on a 401, then re-consent. |
| `src/sync.ts` | `syncReminders` — the reconcile. Idempotent by reminder id. |
| `src/push.ts` | FCM, modular API (v26 removed the `messaging()` default export). |
| `src/nativeAlarm.ts` | JS bridge to the Kotlin alarm. **Do not rewrite.** |
| `src/instructions.ts` | The agent instruction envelope, parser and validator. |
| `src/store.ts` | Device id and last-sync time. Nothing secret. |
| `src/theme.ts`, `src/ui.tsx` | Colour tokens and the shared UI pieces, including `Glyph` — every icon is drawn from plain Views, because an icon package would mean an `expo prebuild` and prebuild deletes the alarm patches. |
| `src/format.ts` | Dates as a person reads them, in one place. |
| `native-patches/` | Every hand-written native file, plus the restore checklist. |

## Definition of done for any change

- `npx tsc --noEmit` is clean.
- `./gradlew assembleDebug` succeeds and the alarm checklist in
  `native-patches/README.md` still passes on the APK.
- A test alarm rings with the phone **locked** and in **airplane mode**.
- A past `at` time is rejected, not silently scheduled.
- A duplicate reminder id does not create a second alarm.

## Scope

In: alarms, sync, sign-in, settings. Out for now: the personal space
(notes/todos/contacts/documents) as native screens, and reading the agent
conversation in-app — phases 2 and 3 of
`Radokuzor/KingsAgent` → `docs/architecture/companion-app-architecture-brief.md`.
