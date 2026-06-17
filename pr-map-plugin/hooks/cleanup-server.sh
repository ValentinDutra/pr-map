#!/usr/bin/env bash
# SessionEnd cleanup: stop the pr-map dashboard server started during the session so no
# orphaned node process is left listening. The server writes its PID to this fixed path.
set -u
pid_file="${TMPDIR:-/tmp}/pr-map-server.pid"
if [ -f "$pid_file" ]; then
  pid="$(cat "$pid_file" 2>/dev/null)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
  fi
  rm -f "$pid_file"
fi
exit 0
