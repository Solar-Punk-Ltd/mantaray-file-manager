#!/bin/bash

BEE_DIR="$(dirname "$0")/bee-dev"
LOG_FILE="bee.log"
BEE_DATA_DIR="$(dirname "$0")/bee-data"
BEE_PID_FILE="bee.pid"
BEE_PORT=1733

# Stop Bee node if it's running
if [ -f "$BEE_PID_FILE" ]; then
  BEE_PID=$(cat "$BEE_PID_FILE")
  echo "Stopping Bee node with PID $BEE_PID..."

  # Kill process and wait for it to terminate
  kill "$BEE_PID" 2>/dev/null
  sleep 5

  # Force kill if process is still running
  if ps -p $BEE_PID > /dev/null; then
    echo "Force killing Bee node with PID $BEE_PID..."
    kill -9 "$BEE_PID"
  fi

  rm "$BEE_PID_FILE"
  echo "Bee node stopped."
else
  echo "Bee node is not running or PID file not found."
fi

# Check for any processes still using the port and kill them
BEE_PROCESS=$(lsof -t -i:$BEE_PORT)
if [ -n "$BEE_PROCESS" ]; then
  echo "Killing process using port $BEE_PORT..."
  kill -9 $BEE_PROCESS
fi

# Clean up Bee files and logs
if [ -f "$LOG_FILE" ]; then
  echo "Deleting log file..."
  rm -f "$LOG_FILE"
fi

if [ -d "$BEE_DIR" ]; then
  echo "Deleting Bee repository folder..."
  rm -rf "$BEE_DIR"
fi

if [ -d "$BEE_DATA_DIR" ]; then
  echo "Deleting Bee data directory..."
  rm -rf "$BEE_DATA_DIR"
fi

echo "Cleanup completed."
