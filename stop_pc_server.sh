#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

PID_FILE_SERVER="$DIR/.server.pid"
PID_FILE_TUNNEL="$DIR/.tunnel.pid"

STOPPED=0

if [ -f "$PID_FILE_SERVER" ]; then
  PID=$(cat "$PID_FILE_SERVER" 2>/dev/null || true)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "Остановка сервера Node.js (PID $PID)..."
    kill "$PID" 2>/dev/null || true
    STOPPED=1
  fi
  rm -f "$PID_FILE_SERVER"
fi

if [ -f "$PID_FILE_TUNNEL" ]; then
  PID=$(cat "$PID_FILE_TUNNEL" 2>/dev/null || true)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "Остановка Cloudflare Tunnel (PID $PID)..."
    kill "$PID" 2>/dev/null || true
    STOPPED=1
  fi
  rm -f "$PID_FILE_TUNNEL"
fi

pkill -f "cloudflared tunnel --url http://localhost:3000" 2>/dev/null || true

if [ $STOPPED -eq 1 ]; then
  echo "✅ Сервер «Родня» и Cloudflare Tunnel успешно остановлены."
else
  echo "Сервер не был запущен."
fi
