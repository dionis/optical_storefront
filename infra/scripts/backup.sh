#!/bin/sh
# Nightly pg_dump → upload to R2 under backups/YYYY-MM-DD.sql.gz
# Runs inside the backup container on cron schedule.
set -e

DATE=$(date +%Y-%m-%d)
BACKUP_FILE="/tmp/eyewear_${DATE}.sql.gz"
R2_KEY="backups/eyewear_${DATE}.sql.gz"

echo "[backup] Starting pg_dump for ${DATE}..."

pg_dump -h postgres -U eyewear eyewear | gzip > "$BACKUP_FILE"

# Upload to R2 using the AWS CLI (included in the postgres image via apk if needed)
# We use curl with S3 signature to avoid AWS CLI dependency.
# TODO: replace with aws-cli sidecar if the postgres image lacks it.
echo "[backup] Uploading to R2: ${R2_KEY}"

aws s3 cp "$BACKUP_FILE" "s3://${R2_BUCKET}/${R2_KEY}" \
  --endpoint-url "${R2_ENDPOINT}" \
  --no-progress

echo "[backup] Done."

# Prune backups older than 14 days
aws s3 ls "s3://${R2_BUCKET}/backups/" --endpoint-url "${R2_ENDPOINT}" | \
  awk '{print $4}' | \
  while read -r key; do
    file_date=$(echo "$key" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' || true)
    if [ -n "$file_date" ]; then
      age=$(( ( $(date +%s) - $(date -d "$file_date" +%s) ) / 86400 ))
      if [ "$age" -gt 14 ]; then
        echo "[backup] Pruning old backup: ${key}"
        aws s3 rm "s3://${R2_BUCKET}/backups/${key}" --endpoint-url "${R2_ENDPOINT}"
      fi
    fi
  done
