#!/usr/bin/env bash
# Actualiza o Pacotinho Já depois de um "git pull".   Uso: sudo bash deploy/update.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${SUDO_USER:-$(stat -c %U "$APP_DIR")}"
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --omit=dev --no-audit --no-fund --loglevel=error
systemctl restart pacotinho
sleep 4
curl -fsS localhost:3000/api/health >/dev/null && echo "✅ Actualizado e a funcionar." || { echo "❌ Problema:"; journalctl -u pacotinho -n 30 --no-pager; exit 1; }
