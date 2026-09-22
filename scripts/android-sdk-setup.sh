#!/bin/bash
# Install a JDK and the Android SDK so this app can be TESTED and BUILT LOCALLY on this Mac.
# Deliberately no Android Studio, no sudo, no GUI. Idempotent, safe to re-run.
#
#   bash ~/Documents/companion-app/scripts/android-sdk-setup.sh
#
# Result:
#   JDK    -> ~/.jdks/temurin-17
#   SDK    -> ~/Library/Android/sdk   (the path Gradle/Expo expect by default)

set -e

JDK_DIR="$HOME/.jdks/temurin-17"
SDK_DIR="$HOME/Library/Android/sdk"
CMDLINE="$SDK_DIR/cmdline-tools/latest"
export HOMEBREW_NO_AUTO_UPDATE=1
export NONINTERACTIVE=1

echo "=== 1. JDK 17 (Temurin tarball, no sudo needed) ==="
if [ -x "$JDK_DIR/Contents/Home/bin/java" ]; then
  echo "already present: $JDK_DIR"
else
  mkdir -p "$HOME/.jdks"
  cd "$HOME/.jdks"
  echo "downloading the latest Temurin 17 for arm64..."
  curl -L --fail --progress-bar -o temurin17.tar.gz \
    "https://api.adoptium.net/v3/binary/latest/17/ga/mac/aarch64/jdk/hotspot/normal/eclipse"
  mkdir -p "$JDK_DIR"
  tar -xzf temurin17.tar.gz -C "$JDK_DIR" --strip-components=1
  rm -f temurin17.tar.gz
fi
export JAVA_HOME="$JDK_DIR/Contents/Home"
"$JAVA_HOME/bin/java" -version

echo
echo "=== 2. Android command line tools ==="
if [ -x "$(command -v sdkmanager 2>/dev/null || echo /nonexistent)" ] || [ -x "$CMDLINE/bin/sdkmanager" ]; then
  echo "sdkmanager already available"
else
  echo "installing via Homebrew (archive cask, no sudo)"
  brew install --cask android-commandlinetools
fi

# The cask installs under Homebrew's share dir; link it into the standard SDK path.
HB_TOOLS="$(brew --prefix 2>/dev/null)/share/android-commandlinetools"
if [ ! -x "$CMDLINE/bin/sdkmanager" ] && [ -x "$HB_TOOLS/cmdline-tools/latest/bin/sdkmanager" ]; then
  mkdir -p "$SDK_DIR"
  ln -sfn "$HB_TOOLS/cmdline-tools" "$SDK_DIR/cmdline-tools"
fi
if [ ! -x "$CMDLINE/bin/sdkmanager" ] && [ -x "$HB_TOOLS/bin/sdkmanager" ]; then
  mkdir -p "$SDK_DIR"
  ln -sfn "$HB_TOOLS" "$SDK_DIR/cmdline-tools"
fi

export ANDROID_HOME="$SDK_DIR"
export ANDROID_SDK_ROOT="$SDK_DIR"
export PATH="$CMDLINE/bin:$SDK_DIR/platform-tools:$PATH"

if [ ! -x "$CMDLINE/bin/sdkmanager" ]; then
  echo "ERROR: sdkmanager still not found. Looked in:"
  echo "  $CMDLINE/bin/sdkmanager"
  echo "  $HB_TOOLS"
  exit 1
fi

echo
echo "=== 3. Accepting licences ==="
yes | sdkmanager --licenses > /dev/null 2>&1 || true

echo
echo "=== 4. Installing SDK packages (this is the big download) ==="
sdkmanager --install \
  "platform-tools" \
  "platforms;android-36" \
  "platforms;android-35" \
  "build-tools;36.0.0" \
  "build-tools;35.0.0" \
  "cmdline-tools;latest"

echo
echo "=== 5. Installed ==="
sdkmanager --list_installed

echo
echo "=== 6. Point the app at this SDK ==="
cd ~/Documents/companion-app
if [ -d android ]; then
  echo "sdk.dir=$SDK_DIR" > android/local.properties
  echo "wrote android/local.properties"
else
  echo "no android/ folder yet. Run: npx expo prebuild -p android"
fi

echo
echo "SETUP_COMPLETE"
echo "Add this to your shell so future builds find everything:"
echo "export JAVA_HOME=\"$JDK_DIR/Contents/Home\""
echo "export ANDROID_HOME=\"$SDK_DIR\""
echo "export PATH=\"\$JAVA_HOME/bin:\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/cmdline-tools/latest/bin:\$PATH\""
