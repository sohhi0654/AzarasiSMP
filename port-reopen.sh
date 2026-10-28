#!/usr/bin/env bash
set -u

# このスクリプトはMinecraftサーバーと同じLAN内のホストで実行してください。
# Render上ではルーターのUPnPへ到達できないため実行しません。
VOICE_PORT=24640
LOBBY_VOICE_PORT=1100
BEDROCK_PORT=19520
INTERVAL=28800

get_local_ip() {
  hostname -I 2>/dev/null | awk '{print $1}'
}

map_port() {
  local port="$1"
  local protocol="$2"
  upnpc -d "$port" "$protocol" >/dev/null 2>&1 || true
  upnpc -a "$SERVER_IP" "$port" "$port" "$protocol" >/dev/null 2>&1 || \
    echo "[$(date)] UPnP再開放に失敗: $port/$protocol"
}

echo "[$(date)] ポート自動再開放タスクを開始しました。（間隔: 8時間）"

while true; do
  SERVER_IP="$(get_local_ip)"
  if [ -z "$SERVER_IP" ]; then
    echo "[$(date)] ローカルIPを取得できませんでした。"
  else
    echo "[$(date)] ポートの再開放を実行中（宛先: $SERVER_IP）..."
    map_port "$VOICE_PORT" UDP
    map_port "$LOBBY_VOICE_PORT" UDP
    map_port "$BEDROCK_PORT" UDP
    echo "[$(date)] 開放完了。次の実行まで待機します..."
  fi
  sleep "$INTERVAL"
done
