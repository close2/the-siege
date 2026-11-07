#!/usr/bin/env bash
# Daily hot backup of the SQLite database using sqlite3 .backup (safe while WAL mode is active).
# Install in /etc/cron.daily/siege-backup (chmod +x).
set -euo pipefail

DB_PATH="${DB_PATH:-/var/lib/siege/siege.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/siege}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
DST="$BACKUP_DIR/siege-$STAMP.db"

sqlite3 "$DB_PATH" ".backup '$DST'"
gzip -9 "$DST"

find "$BACKUP_DIR" -name 'siege-*.db.gz' -mtime +"$KEEP_DAYS" -delete
