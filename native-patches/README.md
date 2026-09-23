# Native patches — READ THIS BEFORE RUNNING `npx expo prebuild`

`npx expo prebuild` regenerates `android/` from `app.json`. It does **not** know about
anything we hand-wrote, so it will silently delete all of the following:

| File | What we changed there |
|---|---|
| `android/app/build.gradle` | release `signingConfig` pointing at our keystore; `androidResources { noCompress 'wav' }`; `apply plugin: 'com.google.gms.google-services'` |
| `android/build.gradle` | google-services plugin classpath |
| `android/app/src/main/AndroidManifest.xml` | the five alarm components (AlarmReceiver, AlarmActionReceiver, BootReceiver, AlarmService, AlarmActivity) plus WAKE_LOCK, FOREGROUND_SERVICE, FOREGROUND_SERVICE_MEDIA_PLAYBACK, USE_FULL_SCREEN_INTENT; also the `kingsagent://` intent-filter on `MainActivity` that lets the KingsChat sign-in Custom Tab hand control back without the person switching apps by hand (see `SignInScreen.tsx`) — losing this one is quieter than losing the alarm, since sign-in still works, it just goes back to asking people to switch back manually |
| `MainApplication.kt` | `add(com.kingschat.kingsagent.alarm.AlarmPackage())`, without which the JS bridge to the alarm disappears |
| `android/gradle.properties` | `reactNativeArchitectures=arm64-v8a`, plus the KINGSAGENT_* signing secrets (passwords blanked here, see below) |
| `alarm/*.kt` | the entire Level 2 alarm implementation |
| `raw/alarm.wav` | the looping alarm sound |

> **The signing passwords are deliberately NOT in this repository.** They are blank in the
> copy of `gradle.properties` kept here, because this repo is public and a signing password
> in public means anyone can sign as this app. When you restore the file into `android/`,
> fill `KINGSAGENT_STORE_PASSWORD` and `KINGSAGENT_KEY_PASSWORD` in from
> `credentials/release-keystore-password.txt` (gitignored). Left blank, a release build
> fails rather than shipping unsigned. Never commit that file or paste it here.

**If prebuild is ever unavoidable**, after it runs, copy these back from this folder and
re-verify with the checklist at the bottom of this file. The single most dangerous loss is
`MainApplication.kt`, because the app will still build and run, it will simply report
"notification only" on the Alarms tab and quietly stop being a real alarm.

## Why not just register a config plugin?

That is the correct long-term answer, and it is worth doing once the app stops changing
daily. A plugin would reapply the manifest entries, the gradle changes and the sound on
every prebuild. Until then, this folder plus discipline is cheaper.

## Verify after any prebuild or a clean checkout

```bash
cd ~/Documents/companion-app/android
export JAVA_HOME="$HOME/.jdks/temurin-17/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
./gradlew assembleRelease --no-daemon

BT="$ANDROID_HOME/build-tools/36.0.0"
APK=app/build/outputs/apk/release/app-release.apk

# 1. signed with OUR key, not the debug key
"$BT/apksigner" verify --print-certs "$APK" | grep "Signer #1 certificate DN"
#    expect: CN=Kings Agent, OU=Mobile, O=Kings Agent, L=Lagos, ST=Lagos, C=NG

# 2. the alarm components are declared
"$BT/aapt2" dump xmltree --file AndroidManifest.xml "$APK" | grep -c "kingsagent.alarm"
#    expect: 5

# 3. the four new permissions survive
"$BT/aapt2" dump badging "$APK" | grep -c "WAKE_LOCK\|FOREGROUND_SERVICE\|FULL_SCREEN_INTENT"
#    expect: 4

# 4. the alarm sound is packed UNCOMPRESSED (0% ratio)
unzip -v "$APK" | grep "\.wav"
#    expect: "Stored", 0%

# 5. arm64 only
unzip -l "$APK" | grep -oE "lib/[^/]+/" | sort -u
#    expect: lib/arm64-v8a/ only

# 6. Firebase values are baked in
"$BT/aapt2" dump resources "$APK" | grep -c "google_app_id\|project_id\|gcm_defaultSenderId"
#    expect: 3

# 7. the sign-in redirect scheme survives
"$BT/aapt2" dump xmltree --file AndroidManifest.xml "$APK" | grep -c "kingsagent"
#    expect: at least 1 (the intent-filter's data scheme)
```
