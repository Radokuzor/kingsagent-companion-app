#!/usr/bin/env bash
# Restore every hand-written native file after `expo prebuild` regenerated
# android/ and silently deleted them. See native-patches/README.md for what
# each file changes and why.
#
#   bash scripts/restore-native-patches.sh
#
# The most dangerous loss is MainApplication.kt: without AlarmPackage the app
# still builds and runs, it just quietly stops being a real alarm.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
P="$ROOT/native-patches"
A="$ROOT/android"
PKG="$A/app/src/main/java/com/kingschat/kingsagent"

[ -d "$A" ] || { echo "No android/ — run: npx expo prebuild -p android" >&2; exit 1; }

echo "== gradle =="
cp "$P/root-build.gradle"  "$A/build.gradle"
cp "$P/app-build.gradle"   "$A/app/build.gradle"

# gradle.properties carries the signing secrets, which are BLANK in the copy
# kept here because this repo is public. Merge rather than overwrite, so a
# local file that already has them filled in is not clobbered.
if [ ! -f "$A/gradle.properties" ] || ! grep -q "KINGSAGENT_STORE_FILE" "$A/gradle.properties"; then
  cat "$P/gradle.properties" > "$A/gradle.properties"
  echo "   gradle.properties written (signing passwords are BLANK — fill them in for a release build)"
else
  echo "   gradle.properties already has signing config, left alone"
fi

echo "== manifest =="
cp "$P/AndroidManifest.xml" "$A/app/src/main/AndroidManifest.xml"

echo "== kotlin =="
mkdir -p "$PKG/alarm"
cp "$P/MainApplication.kt" "$PKG/MainApplication.kt"
cp "$P"/alarm/*.kt "$PKG/alarm/"

echo "== alarm sound =="
mkdir -p "$A/app/src/main/res/raw"
cp "$P/raw/alarm.wav" "$A/app/src/main/res/raw/alarm.wav"

# The Expo plugin copies google-services.json into android/app/ at PREBUILD
# time, so replacing the file at the repo root does nothing on its own — the
# build keeps reading the stale copy. This bit me once: a release APK built
# after dropping in the real file still had the placeholder's google_app_id
# baked in, which would have shipped an app whose push silently never worked.
echo "== firebase config =="
if [ -f "$ROOT/google-services.json" ]; then
  cp "$ROOT/google-services.json" "$A/app/google-services.json"
  appid=$(grep -o '"mobilesdk_app_id"[^,]*' "$A/app/google-services.json" | head -1)
  echo "   synced -> android/app/  ($appid)"
  case "$appid" in
    *0000000000*) echo "   WARNING: that is the PLACEHOLDER — FCM will not work with it" ;;
  esac
else
  echo "   WARNING: no google-services.json at the repo root — the build will fail"
fi

echo "== sdk location =="
if [ -d "$HOME/Android/Sdk" ]; then
  echo "sdk.dir=$HOME/Android/Sdk" > "$A/local.properties"
  echo "   local.properties -> $HOME/Android/Sdk"
fi

echo
echo "== checks =="
grep -q "AlarmPackage()" "$PKG/MainApplication.kt" \
  && echo "   OK  AlarmPackage registered (the JS bridge to the alarm)" \
  || { echo "   FAIL MainApplication.kt has no AlarmPackage" >&2; exit 1; }
# The manifest names them relatively (".alarm.AlarmReceiver"); only the built
# APK shows them expanded, which is what native-patches/README.md's aapt2
# check counts. Five: AlarmReceiver, AlarmActionReceiver, BootReceiver,
# AlarmService, AlarmActivity.
n=$(grep -c 'android:name="\.alarm\.' "$A/app/src/main/AndroidManifest.xml" || true)
[ "$n" -ge 5 ] && echo "   OK  $n alarm components declared" \
  || { echo "   FAIL only $n alarm components in the manifest (expect 5)" >&2; exit 1; }
grep -q "noCompress 'wav'" "$A/app/build.gradle" \
  && echo "   OK  alarm sound will be packed uncompressed" \
  || { echo "   FAIL app/build.gradle lost noCompress 'wav'" >&2; exit 1; }
ls "$PKG/alarm"/*.kt >/dev/null && echo "   OK  $(ls "$PKG/alarm"/*.kt | wc -l) alarm sources in place"

echo
echo "RESTORE_COMPLETE"
