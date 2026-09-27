#!/usr/bin/env bash
set -euo pipefail

ZONE="europe-north1-b"
VM_NAME="traccar-vm"
BUCKET="gs://koredu-traccar-backup"
DATE="$(date +%F)"
SNAPSHOT_DATE="$(date +%Y%m%d)"

REMOTE_BACKUP_DIR="\$HOME/backup"
REMOTE_DUMP_NAME="traccar-${DATE}.sql.gz"
REMOTE_DUMP_PATH="\$HOME/backup/${REMOTE_DUMP_NAME}"

LOCAL_BACKUP_DIR="${HOME}/traccar-backup"
LOCAL_DUMP_PATH="${LOCAL_BACKUP_DIR}/${REMOTE_DUMP_NAME}"

mkdir -p "${LOCAL_BACKUP_DIR}"

echo "==> Creating PostgreSQL backup on VM"
gcloud compute ssh "${VM_NAME}" \
  --zone="${ZONE}" \
  --command="
    set -euo pipefail
    sudo systemctl stop traccar
    mkdir -p ${REMOTE_BACKUP_DIR}
    sudo -u postgres pg_dump -d traccar | gzip > ${REMOTE_DUMP_PATH}
    ls -lh ${REMOTE_DUMP_PATH}
  "

echo "==> Copying backup from VM to local machine"
gcloud compute scp \
  --zone="${ZONE}" \
  "${VM_NAME}:~/backup/${REMOTE_DUMP_NAME}" \
  "${LOCAL_DUMP_PATH}"

echo "==> Uploading backup to Cloud Storage"
gcloud storage cp \
  "${LOCAL_DUMP_PATH}" \
  "${BUCKET}/"

echo "==> Determining boot disk name"
DISK_NAME="$(
  gcloud compute instances describe "${VM_NAME}" \
    --zone="${ZONE}" \
    --format='get(disks[0].source.basename())'
)"

echo "==> Creating disk snapshot"
gcloud compute disks snapshot "${DISK_NAME}" \
  --zone="${ZONE}" \
  --snapshot-names="${VM_NAME}-boot-${SNAPSHOT_DATE}"

echo "==> Stopping VM"
gcloud compute instances stop "${VM_NAME}" --zone="${ZONE}"

echo
echo "Done."
echo "Local dump:   ${LOCAL_DUMP_PATH}"
echo "GCS object:   ${BUCKET}/${REMOTE_DUMP_NAME}"
echo "Snapshot:     ${VM_NAME}-boot-${SNAPSHOT_DATE}"