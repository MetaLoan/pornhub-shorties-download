#!/bin/bash
# com.shorties.downloader - Native Messaging Shell Wrapper for macOS

# Get the directory of this wrapper script
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$DIR/native_debug.log"

echo "=== Native Host Init at $(date) ===" >> "$LOG_FILE"

# Try to find python3 in common installation paths
if [ -x "/opt/homebrew/bin/python3" ]; then
  PYTHON_BIN="/opt/homebrew/bin/python3"
elif [ -x "/usr/local/bin/python3" ]; then
  PYTHON_BIN="/usr/local/bin/python3"
elif [ -x "/usr/bin/python3" ]; then
  PYTHON_BIN="/usr/bin/python3"
else
  PYTHON_BIN="python3"
fi

echo "Selected python binary: $PYTHON_BIN" >> "$LOG_FILE"
echo "Executing: $DIR/native_host.py" >> "$LOG_FILE"

# Execute the python script, redirecting stderr to native_debug.log
exec "$PYTHON_BIN" "$DIR/native_host.py" "$@" 2>> "$LOG_FILE"
