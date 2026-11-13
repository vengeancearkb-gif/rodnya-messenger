#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

SERVER_ACTIVE=$(systemctl --user is-active rodnya-server 2>/dev/null || echo "inactive")
TUNNEL_ACTIVE=$(systemctl --user is-active rodnya-tunnel 2>/dev/null || echo "inactive")

LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' || true)
if [ -z "$LAN_IP" ]; then
  LAN_IP="192.168.1.106"
fi

PUBLIC_URL=$(journalctl --user -u rodnya-tunnel -n 50 --no-pager 2>/dev/null | grep -oE "https://[a-zA-Z0-9-]+\.trycloudflare\.com" | tail -n 1 || true)

if [ -n "$PUBLIC_URL" ]; then
  echo "$PUBLIC_URL" > SERVER_URL.txt
fi

echo "=========================================================="
echo "    📡 Статус сервера мессенджера «Родня» на вашем ПК"
echo "=========================================================="
echo "Статус сервера:  $SERVER_ACTIVE"
echo "Статус туннеля:  $TUNNEL_ACTIVE"
echo "----------------------------------------------------------"
echo "🏠 Локальный адрес (для домашнего Wi-Fi):"
echo "   http://$LAN_IP:3000"
echo ""
echo "🌍 Глобальный интернет-адрес (для 4G, улицы и других городов):"
if [ -n "$PUBLIC_URL" ]; then
  echo "   $PUBLIC_URL"
  echo ""
  if command -v qrencode >/dev/null 2>&1; then
    echo "📱 QR-код для быстрого сканирования телефоном:"
    qrencode -t UTF8 "$PUBLIC_URL"
    echo ""
  fi
else
  echo "   (Туннель запускается, подождите пару секунд...)"
fi
echo "=========================================================="
echo "💡 Управление службой на ПК:"
echo "   Запустить:      systemctl --user start rodnya-server rodnya-tunnel"
echo "   Остановить:     systemctl --user stop rodnya-server rodnya-tunnel"
echo "   Перезапустить:  systemctl --user restart rodnya-server rodnya-tunnel"
echo "   Логи сервера:   journalctl --user -u rodnya-server -f"
echo "   Логи туннеля:   journalctl --user -u rodnya-tunnel -f"
echo "=========================================================="
