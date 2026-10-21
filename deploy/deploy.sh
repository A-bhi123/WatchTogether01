#!/usr/bin/env bash
# Server par chalao:  bash deploy/deploy.sh   (project ke root folder se)
# Naya code lata hai, build karta hai, aur backend ko bina rukawat ke dobara chalata hai.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Naya code (git pull)"
git pull --ff-only

echo "==> Backend dependencies (sirf production wali)"
(cd backend && npm ci --omit=dev)

echo "==> Frontend build"
(cd frontend && npm ci && npm run build)
rsync -a --delete frontend/dist/ /var/www/watchtogether/

echo "==> Backend dobara chalao"
(cd backend && pm2 startOrReload ecosystem.config.js --update-env)
pm2 save

echo "==> Ho gaya. Check:  pm2 status   aur   curl -s https://YOUR_DOMAIN/api/health"