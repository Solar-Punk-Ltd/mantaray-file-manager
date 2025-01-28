#!/bin/bash

BEE_REPO="git@github.com:Solar-Punk-Ltd/bee-dev.git"
BEE_BRANCH="test/bee-dev"
BEE_DIR="$(dirname "$0")/bee-dev"
BEE_BINARY_PATH="$BEE_DIR/dist/bee"
LOG_FILE="bee.log"
BEE_PID_FILE="bee.pid"

# Navigate to script directory
cd "$(dirname "$0")" || exit

# Clone the Bee repository if not present
if [ ! -d "$BEE_DIR" ]; then
  echo "Cloning Bee repository into $BEE_DIR..."
  git clone "$BEE_REPO" "$BEE_DIR"
fi

cd "$BEE_DIR" || exit

# Checkout the latest code
echo "Fetching latest code..."
git fetch origin "$BEE_BRANCH"
git checkout "$BEE_BRANCH"

LATEST_COMMIT=$(git rev-parse --short HEAD)
echo "Latest Bee commit: $LATEST_COMMIT"
git checkout "$LATEST_COMMIT"

# Build the Bee binary with error handling
if ! make binary; then
  echo "Build failed. Exiting."
  exit 1
fi

# Verify binary existence and permissions
if [ ! -f "$BEE_BINARY_PATH" ]; then
  echo "Bee binary not found at $BEE_BINARY_PATH. Exiting."
  exit 1
fi

chmod +x "$BEE_BINARY_PATH"
echo "Bee binary built successfully."

cd ..

# Run the Bee node with required parameters in the background
echo "Starting Bee node with custom parameters in background..."

nohup $BEE_BINARY_PATH dev \
  --api-addr=":1733" \
  --verbosity=5 \
  --cors-allowed-origins="*" > "$LOG_FILE" 2>&1 &

BEE_PID=$!
echo $BEE_PID > "$BEE_PID_FILE"

# Ensure the process doesn't terminate immediately
echo "Bee node is running with PID $BEE_PID"
echo "Logs are being saved to $LOG_FILE. To view logs, run: tail -f $LOG_FILE"

# Wait to ensure it's healthy before returning control
sleep 10

# Check Bee node health
if ! curl --silent --fail http://localhost:1733/health; then
  echo "Bee node health check failed. Exiting.";
  exit 1
fi

echo "Bee node is healthy and ready to process requests."
