#!/usr/bin/env bash
# Roz raat database ka backup (root ke cron se chalta hai). 7 din se purane backup apne aap hat jate hain.
# Movie files ka backup nahi: wo dobara upload ho sakti hain.
set -euo pipefail

BACKUP_DIR=/var/backups/watchtogether
DB_NAME=watchtogether

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%F_%H%M)

sudo -u postgres pg_dump "$DB_NAME" | gzip > "$BACKUP_DIR/db_$STAMP.sql.gz"
find "$BACKUP_DIR" -name 'db_*.sql.gz' -mtime +7 -delete

echo "Backup ban gaya: $BACKUP_DIR/db_$STAMP.sql.gz"