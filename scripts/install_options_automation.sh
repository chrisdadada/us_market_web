#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="${AUTOMATION_ROOT:-/Users/linlifu/Documents/New project-automation-refresh}"
REQUIRED_BRANCH="${REQUIRED_REFRESH_BRANCH:-codex/automation-refresh}"
PLIST="${HOME}/Library/LaunchAgents/com.meigustrategy.marketdata.options-refresh.plist"
LOG_DIR="${ROOT}/logs/automation"

# Install the scheduled job only against the dedicated, clean data-refresh worktree.
# This keeps old feature branches and the production-code release path out of automation.
source "${ROOT}/scripts/refresh_workspace_guard.sh"
require_refresh_workspace "${ROOT}" "${REQUIRED_BRANCH}"

mkdir -p "${LOG_DIR}" "$(dirname "${PLIST}")"

cat > "${PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.meigustrategy.marketdata.options-refresh</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${ROOT}/scripts/options_refresh.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>StartCalendarInterval</key>
  <array>
    <dict>
      <key>Weekday</key>
      <integer>2</integer>
      <key>Hour</key>
      <integer>10</integer>
      <key>Minute</key>
      <integer>45</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>3</integer>
      <key>Hour</key>
      <integer>10</integer>
      <key>Minute</key>
      <integer>45</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>4</integer>
      <key>Hour</key>
      <integer>10</integer>
      <key>Minute</key>
      <integer>45</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>5</integer>
      <key>Hour</key>
      <integer>10</integer>
      <key>Minute</key>
      <integer>45</integer>
    </dict>
    <dict>
      <key>Weekday</key>
      <integer>6</integer>
      <key>Hour</key>
      <integer>10</integer>
      <key>Minute</key>
      <integer>45</integer>
    </dict>
  </array>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/options-launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/options-launchd.err.log</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST

launchctl unload "${PLIST}" 2>/dev/null || true
launchctl load "${PLIST}"

echo "Installed launchd job: ${PLIST}"
echo "It will run Tuesday-Saturday at 10:45 local time."
echo "Manual run: bash '${ROOT}/scripts/options_refresh.sh'"
echo "Catch-up run: OPTIONS_MAX_DAYS=5 bash '${ROOT}/scripts/options_refresh.sh'"
echo "Logs: ${LOG_DIR}"
