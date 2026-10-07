#!/bin/bash
# Starts the Pudle Expo Go demo server. Double-click in Finder; keep this window open while demoing.
# Scan the QR code with each iPhone's Camera app (Expo Go must be installed).
# "--tunnel" lets phones connect over cellular while driving (not only on home Wi-Fi).
cd "$(dirname "$0")" || exit 1
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -d /opt/homebrew/bin ] && export PATH="/opt/homebrew/bin:$PATH"
[ -d /usr/local/bin ] && export PATH="/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  echo "Node.js is not installed. Install it from https://nodejs.org (LTS), then double-click this again."
  read -r -p "Press Return to close." _; exit 1
fi
echo "Node $(node -v)"
if [ ! -f .env.local ]; then
  echo "Missing .env.local (Supabase URL + publishable key). Copy .env.example to .env.local and fill it in."
  read -r -p "Press Return to close." _; exit 1
fi
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing packages (first run only)…"
  npm ci --no-audit --no-fund || { read -r -p "npm install failed. Press Return to close." _; exit 1; }
fi
npx expo start --tunnel --clear
