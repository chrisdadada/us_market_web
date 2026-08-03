#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.meigustrategy.marketdata.refresh"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${ROOT}/logs/automation"
NODE_BIN="$(dirname "$(command -v node)")"
PATH_VALUE="${NODE_BIN}:/opt/homebrew/bin:/opt/anaconda3/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DOMAIN="gui/$(id -u)"

mkdir -p "${LOG_DIR}" "$(dirname "${PLIST}")"

cat >"${PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${ROOT}/scripts/automated_refresh.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>PATH</key>
    <string>${PATH_VALUE}</string>
    <key>DEPLOY_PROD_DATA_AFTER_REFRESH</key>
    <string>1</string>
    <key>PROMOTE_PROD_AFTER_DEPLOY</key>
    <string>0</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>
$(for weekday in 2 3 4 5 6; do cat <<INTERVAL
    <dict>
      <key>Weekday</key><integer>${weekday}</integer>
      <key>Hour</key><integer>13</integer>
      <key>Minute</key><integer>31</integer>
    </dict>
INTERVAL
done)
  </array>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/refresh-launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/refresh-launchd.err.log</string>
  <key>ProcessType</key>
  <string>Background</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST

plutil -lint "${PLIST}"
launchctl bootout "${DOMAIN}" "${PLIST}" 2>/dev/null || true
launchctl bootstrap "${DOMAIN}" "${PLIST}"
launchctl enable "${DOMAIN}/${LABEL}"

echo "Installed ${LABEL}: Tuesday-Saturday 13:31 local time"
echo "Logs: ${LOG_DIR}"
