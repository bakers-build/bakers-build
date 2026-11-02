# Sourced by bin/start and bin/stop.
# running PID-FILE WORD: the pid lives and its command line has WORD. A pid file can outlive a
# restart, and its pid then belong to another process.
running() {
  local pid
  pid="$(cat "$1" 2>/dev/null)" && kill -0 "$pid" 2>/dev/null \
    && ps -o args= -p "$pid" 2>/dev/null | grep -q -- "$2"
}
