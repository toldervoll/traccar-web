#!/usr/bin/env bash
set -euo pipefail

ZONE="europe-north1-b"
VM_NAME="traccar-vm"
BUCKET="gs://koredu-traccar-backup"

# Set this to the backup date you want to restore
DATE_TO_RESTORE="2026-04-12"

DUMP_NAME="traccar-${DATE_TO_RESTORE}.sql.gz"
LOCAL_BACKUP_DIR="${HOME}/traccar-backup"
LOCAL_DUMP_PATH="${LOCAL_BACKUP_DIR}/${DUMP_NAME}"

mkdir -p "${LOCAL_BACKUP_DIR}"

echo "==> Starting VM"
gcloud compute instances start "${VM_NAME}" --zone="${ZONE}"

echo "==> Downloading backup from Cloud Storage"
gcloud storage cp \
  "${BUCKET}/${DUMP_NAME}" \
  "${LOCAL_DUMP_PATH}"

echo "==> Copying backup to VM"
gcloud compute scp \
  --zone="${ZONE}" \
  "${LOCAL_DUMP_PATH}" \
  "${VM_NAME}:~/"

echo "==> Restoring PostgreSQL database on VM"
gcloud compute ssh "${VM_NAME}" \
  --zone="${ZONE}" \
  --command="
    set -euo pipefail
    sudo systemctl stop traccar

    gzip -t ~/${DUMP_NAME}

    sudo -u postgres psql -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'traccar' AND pid <> pg_backend_pid();\"
    sudo -u postgres psql -c \"DROP DATABASE IF EXISTS traccar;\"
    sudo -u postgres psql -c \"CREATE DATABASE traccar OWNER traccar;\"

    gunzip -c ~/${DUMP_NAME} | sudo -u postgres psql -d traccar

    sudo systemctl start traccar
    sudo systemctl status traccar --no-pager
  "

echo
echo "Restore complete."
echo "Restored dump: ${DUMP_NAME}"