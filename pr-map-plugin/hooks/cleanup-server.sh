#!/usr/bin/env bash
# SessionEnd cleanup: stop the pr-map dashboard server(s) started during the session so no
# orphaned node process is left listening. Each server writes one PID file per port under a
# shared directory, so concurrent dashboards each get cleaned up.
set -u

kill_pid_file() {
  pid_file="$1"
  [ -e "$pid_file" ] || return 0
  pid="$(cat "$pid_file" 2>/dev/null)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
  fi
  rm -f "$pid_file"
}

pid_dir="${TMPDIR:-/tmp}/pr-map-server-pids"
if [ -d "$pid_dir" ]; then
  for pid_file in "$pid_dir"/*.pid; do
    kill_pid_file "$pid_file"
  done
fi

# Back-compat: clean up the old single-file PID location from earlier versions.
kill_pid_file "${TMPDIR:-/tmp}/pr-map-server.pid"

exit 0
