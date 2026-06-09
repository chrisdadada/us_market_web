#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="/Users/linlifu/Documents/New project"
PLIST="${HOME}/Library/LaunchAgents/com.meigustrategy.marketdata.refresh.plist"
LOG_DIR="${ROOT}/logs/automation"

mkdir -p "${LOG_DIR}" "$(dirname "${PLIST}")"

cat > "${PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.meigustrategy.marketdata.refresh</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${ROOT}/scripts/automated_refresh.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>19</integer>
    <key>Minute</key>
    <integer>30</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/launchd.err.log</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST

launchctl unload "${PLIST}" 2>/dev/null || true
launchctl load "${PLIST}"

echo "Installed launchd job: ${PLIST}"
echo "It will run daily at 19:30 local time."
echo "Manual run: bash '${ROOT}/scripts/automated_refresh.sh'"
echo "Logs: ${LOG_DIR}"
