#!/usr/bin/env bash
# Start Channel 8-Bit (station + tunnel) automatically when you log in, and keep it running.
# Undo with: launchctl unload ~/Library/LaunchAgents/com.channel8bit.onair.plist && rm ~/Library/LaunchAgents/com.channel8bit.onair.plist
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
NODE="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/com.channel8bit.onair.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/data/logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.channel8bit.onair</string>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>--import</string><string>tsx</string><string>src/onair.ts</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$ROOT/data/logs/onair.log</string>
  <key>StandardErrorPath</key><string>$ROOT/data/logs/onair.log</string>
</dict>
</plist>
PLIST
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed. Channel 8-Bit will start at login. Logs: $ROOT/data/logs/onair.log"
