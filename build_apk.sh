#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "=========================================================="
echo "      🔨 Сборка APK приложения мессенджера «Родня»"
echo "=========================================================="

export JAVA_HOME=${JAVA_HOME:-$HOME/.jdk21}
export PATH=$JAVA_HOME/bin:$HOME/.gradle-dist/gradle-8.14.3/bin:$PATH
export ANDROID_HOME=${ANDROID_HOME:-$HOME/.android-sdk}

echo "1. Синхронизация веб-ресурсов..."
npx cap sync android

echo "2. Компиляция APK..."
cd android
gradle assembleDebug

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
