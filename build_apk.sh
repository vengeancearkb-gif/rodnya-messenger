#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "=========================================================="
echo "      🔨 Сборка APK приложения мессенджера «Родня»"
echo "=========================================================="

# Setup Java & Android SDK paths with fallback
if [ -z "$JAVA_HOME" ] && [ -d "$HOME/.jdk21" ]; then
  export JAVA_HOME="$HOME/.jdk21"
fi
if [ -n "$JAVA_HOME" ]; then
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if [ -d "$HOME/.gradle-dist/gradle-8.14.3/bin" ]; then
  export PATH="$HOME/.gradle-dist/gradle-8.14.3/bin:$PATH"
fi
export ANDROID_HOME=${ANDROID_HOME:-$HOME/.android-sdk}

echo "1. Синхронизация веб-ресурсов в Capacitor..."
npx cap sync android

echo "2. Компиляция APK..."
cd android
if [ -f "./gradlew" ]; then
  chmod +x ./gradlew
  ./gradlew assembleDebug
else
  gradle assembleDebug
fi

APK_PATH="$DIR/android/app/build/outputs/apk/debug/app-debug.apk"
OUT_DIR="$DIR/release"
mkdir -p "$OUT_DIR"
cp "$APK_PATH" "$OUT_DIR/Rodnya-Messenger.apk"

echo ""
echo "=========================================================="
echo "🎉 Сборка завершена успешно!"
echo "Файл APK готов для установки на Android-смартфоны:"
echo "👉 $OUT_DIR/Rodnya-Messenger.apk"
echo "=========================================================="
