#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

mkdir -p logs

PID_FILE_SERVER="$DIR/.server.pid"
PID_FILE_TUNNEL="$DIR/.tunnel.pid"

# Function to clean up old processes
stop_existing() {
  if [ -f "$PID_FILE_SERVER" ]; then
    OLD_PID=$(cat "$PID_FILE_SERVER" 2>/dev/null || true)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      kill "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$PID_FILE_SERVER"
  fi
  if [ -f "$PID_FILE_TUNNEL" ]; then
    OLD_PID=$(cat "$PID_FILE_TUNNEL" 2>/dev/null || true)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
      kill "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$PID_FILE_TUNNEL"
  fi
  # Kill any stray cloudflared tunnel to port 3000
  pkill -f "cloudflared tunnel --url http://localhost:3000" 2>/dev/null || true
}

stop_existing

echo "=========================================================="
echo "    🚀 Запуск локального сервера «Родня» с Cloudflare"
echo "=========================================================="

# 1. Check cloudflared binary
CLOUDFLARED_BIN=""
if command -v cloudflared >/dev/null 2>&1; then
  CLOUDFLARED_BIN="$(command -v cloudflared)"
elif [ -x "$HOME/.local/bin/cloudflared" ]; then
  CLOUDFLARED_BIN="$HOME/.local/bin/cloudflared"
fi

if [ -z "$CLOUDFLARED_BIN" ]; then
  echo "📥 Скачивание официального бинарника cloudflared..."
  mkdir -p "$HOME/.local/bin"
  curl -L --progress-bar "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64" -o "$HOME/.local/bin/cloudflared"
  chmod +x "$HOME/.local/bin/cloudflared"
  CLOUDFLARED_BIN="$HOME/.local/bin/cloudflared"
fi

# 2. Check Node dependencies
if [ ! -d "server/node_modules" ]; then
  echo "📦 Установка серверных зависимостей (npm install)..."
  (cd server && npm install)
fi

# 3. Start Node.js Server
echo "⚡ Запуск сервера мессенджера (Node.js)..."
> logs/server.log
nohup node server/server.js > logs/server.log 2>&1 &
SERVER_PID=$!
disown $SERVER_PID
echo "$SERVER_PID" > "$PID_FILE_SERVER"

# Wait for server to become healthy
HEALTHY=0
for i in {1..20}; do
  if curl -s http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 0.5
done

if [ $HEALTHY -ne 1 ]; then
  echo "❌ Ошибка запуска сервера! Лог:"
  cat logs/server.log
  exit 1
fi

echo "✅ Сервер успешно работает на порту 3000"

# 4. Start Cloudflare Tunnel
echo "🌐 Подключение защищённого Cloudflare Tunnel..."
> logs/tunnel.log
nohup "$CLOUDFLARED_BIN" tunnel --url http://127.0.0.1:3000 > logs/tunnel.log 2>&1 &
TUNNEL_PID=$!
disown $TUNNEL_PID
echo "$TUNNEL_PID" > "$PID_FILE_TUNNEL"

# Wait for public URL in tunnel log
PUBLIC_URL=""
for i in {1..30}; do
  FOUND=$(grep -oE "https://[a-zA-Z0-9-]+\.trycloudflare\.com" logs/tunnel.log | head -n 1 || true)
  if [ -n "$FOUND" ]; then
    PUBLIC_URL="$FOUND"
    break
  fi
  sleep 0.5
done

if [ -z "$PUBLIC_URL" ]; then
  echo "⚠️ Не удалось получить ссылку Cloudflare автоматически за 15 секунд. Проверьте logs/tunnel.log"
else
  echo "$PUBLIC_URL" > SERVER_URL.txt
fi

# Get Local LAN IP
LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' || true)
if [ -z "$LAN_IP" ]; then
  LAN_IP="192.168.1.106"
fi

echo ""
echo "=========================================================="
echo "🎉 СЕРВЕР МЕССЕНДЖЕРА «РОДНЯ» УСПЕШНО РАБОТАЕТ НА ВАШЕМ ПК!"
echo "=========================================================="
echo ""
echo "🏠 Для домашнего Wi-Fi (мгновенное прямое подключение):"
echo "   http://$LAN_IP:3000"
echo ""
echo "🌍 Для связи отовсюду (с улицы, 4G/LTE, из других городов):"
if [ -n "$PUBLIC_URL" ]; then
  echo "   $PUBLIC_URL"
  echo ""
  if command -v qrencode >/dev/null 2>&1; then
    echo "📱 QR-код для быстрого сканирования телефоном:"
    qrencode -t UTF8 "$PUBLIC_URL"
    echo ""
  fi
else
  echo "   (Подключение устанавливается, проверьте: cat logs/tunnel.log)"
fi
echo "=========================================================="
echo "💡 КАК ПОДКЛЮЧИТЬ ТЕЛЕФОН:"
echo "1. Откройте приложение «Родня» на телефоне."
echo "2. Нажмите иконку ⚙️ (Настройки) или измените поле «Адрес сервера»."
echo "3. Вставьте глобальный адрес выше (или отсканируйте камерой QR-код)."
echo "4. Нажмите «Сохранить» — телефон сразу подключится к вашему ПК!"
echo "=========================================================="
echo "Логи сервера: logs/server.log | Логи туннеля: logs/tunnel.log"
echo "Остановить сервер: ./stop_pc_server.sh или нажмите Ctrl+C"
echo "=========================================================="

cleanup() {
  echo ""
  echo "🛑 Остановка локального сервера и туннеля..."
  kill "$SERVER_PID" 2>/dev/null || true
  kill "$TUNNEL_PID" 2>/dev/null || true
  rm -f "$PID_FILE_SERVER" "$PID_FILE_TUNNEL"
  echo "Выключено."
  exit 0
}

trap cleanup INT TERM

if [ "$1" == "--daemon" ] || [ "$1" == "-d" ]; then
  echo "Сервер запущен в фоновом режиме (демон). PID: $SERVER_PID, Tunnel PID: $TUNNEL_PID"
  exit 0
fi

# Keep foreground alive waiting for Ctrl+C
while true; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "⚠️ Сервер аварийно завершился! Лог:"
    cat logs/server.log
    cleanup
  fi
  sleep 2
done
