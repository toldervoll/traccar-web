#!/usr/bin/env bash
set -euo pipefail

PROJECT="koredu-traccar"
ZONE="europe-north1-b"
REGION="europe-north1"
VM_NAME="traccar-vm"
MACHINE_TYPE="e2-small"
ADDRESS_NAME="traccar-ip"
PREVIOUS_IP="34.88.182.55" # kart.koredu.no DNS (hyp.net) points here
BUCKET="gs://koredu-traccar-backup"

# Set this to the backup date you want to restore
DATE_TO_RESTORE="2026-04-12"

DUMP_NAME="traccar-${DATE_TO_RESTORE}.sql.gz"
LOCAL_BACKUP_DIR="${HOME}/traccar-backup"
LOCAL_DUMP_PATH="${LOCAL_BACKUP_DIR}/${DUMP_NAME}"

mkdir -p "${LOCAL_BACKUP_DIR}"

if ! gcloud compute addresses describe "${ADDRESS_NAME}" --project="${PROJECT}" --region="${REGION}" >/dev/null 2>&1; then
  echo "==> Reserving static IP (trying previous IP ${PREVIOUS_IP} first)"
  gcloud compute addresses create "${ADDRESS_NAME}" --project="${PROJECT}" --region="${REGION}" \
    --addresses="${PREVIOUS_IP}" \
    || gcloud compute addresses create "${ADDRESS_NAME}" --project="${PROJECT}" --region="${REGION}"
fi
VM_IP="$(gcloud compute addresses describe "${ADDRESS_NAME}" --project="${PROJECT}" --region="${REGION}" --format='get(address)')"

if gcloud compute instances describe "${VM_NAME}" --project="${PROJECT}" --zone="${ZONE}" >/dev/null 2>&1; then
  echo "==> Starting VM"
  gcloud compute instances start "${VM_NAME}" --project="${PROJECT}" --zone="${ZONE}"
else
  SNAPSHOT="$(gcloud compute snapshots list --project="${PROJECT}" \
    --filter="name~'^${VM_NAME}-boot-'" --sort-by=~creationTimestamp --limit=1 --format='get(name)')"
  echo "==> Creating VM from snapshot ${SNAPSHOT}"
  gcloud compute instances create "${VM_NAME}" \
    --project="${PROJECT}" \
    --zone="${ZONE}" \
    --machine-type="${MACHINE_TYPE}" \
    --create-disk="boot=yes,name=${VM_NAME},source-snapshot=${SNAPSHOT},size=20,type=pd-balanced,auto-delete=yes" \
    --tags=traccar \
    --address="${VM_IP}"
fi

echo "==> Waiting for SSH"
until gcloud compute ssh "${VM_NAME}" --project="${PROJECT}" --zone="${ZONE}" --command=true >/dev/null 2>&1; do
  sleep 10
done

echo "==> Downloading backup from Cloud Storage"
gcloud storage cp \
  --project="${PROJECT}" \
  "${BUCKET}/${DUMP_NAME}" \
  "${LOCAL_DUMP_PATH}"

echo "==> Copying backup to VM"
gcloud compute scp \
  --project="${PROJECT}" \
  --zone="${ZONE}" \
  "${LOCAL_DUMP_PATH}" \
  "${VM_NAME}:~/"

echo "==> Restoring PostgreSQL database on VM"
gcloud compute ssh "${VM_NAME}" \
  --project="${PROJECT}" \
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

    # Certs expire while the VM is archived; renew fails harmlessly if DNS isn't updated yet
    sudo certbot renew --non-interactive || true
  "

echo
echo "Restore complete."
echo "Restored dump: ${DUMP_NAME}"
echo "VM IP:         ${VM_IP}"
if [ "${VM_IP}" != "${PREVIOUS_IP}" ]; then
  echo "WARNING: IP changed. Update the kart.koredu.no A record at hyp.net to ${VM_IP}."
fi
