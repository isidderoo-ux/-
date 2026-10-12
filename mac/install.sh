#!/bin/bash
# 사용법: ./install.sh <끌 시각 HH:MM> <켤 시각 HH:MM>
# 예시:   ./install.sh 23:00 07:30
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "사용법: $0 <끌 시각 HH:MM> <켤 시각 HH:MM>"
  echo "예시:   $0 23:00 07:30"
  exit 1
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
mkdir -p "$AGENTS"
chmod +x "$DIR/screen_off.sh" "$DIR/screen_on.sh"

make_agent() {
  local label="$1" script="$2" time="$3"
  if ! [[ "$time" =~ ^([01]?[0-9]|2[0-3]):[0-5][0-9]$ ]]; then
    echo "시각 형식이 잘못되었습니다: $time (HH:MM)"; exit 1
  fi
  local hour=$((10#${time%%:*})) minute=$((10#${time##*:}))
  local plist="$AGENTS/$label.plist"

  launchctl unload "$plist" 2>/dev/null || true
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$script</string></array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$hour</integer>
    <key>Minute</key><integer>$minute</integer>
  </dict>
</dict>
</plist>
PLIST
  launchctl load "$plist"
  printf '등록 완료: %s → 매일 %02d:%02d\n' "$label" "$hour" "$minute"
}

make_agent com.user.screen-off "$DIR/screen_off.sh" "$1"
make_agent com.user.screen-on  "$DIR/screen_on.sh"  "$2"
