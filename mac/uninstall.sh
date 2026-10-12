#!/bin/bash
# 등록한 화면 끄기/켜기 예약을 삭제한다
for label in com.user.screen-off com.user.screen-on; do
  plist="$HOME/Library/LaunchAgents/$label.plist"
  launchctl unload "$plist" 2>/dev/null || true
  rm -f "$plist"
  echo "삭제: $label"
done
