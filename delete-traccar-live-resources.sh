#!/usr/bin/env bash
set -euo pipefail

ZONE="europe-north1-b"
REGION="europe-north1"
VM_NAME="traccar-vm"
BUCKET="gs://koredu-traccar-backup"

echo "==> Verifying SQL backup exists"
gcloud storage ls "${BUCKET}/"

echo "==> Verifying snapshot exists"
gcloud compute snapshots list --filter="name~'^${VM_NAME}-boot-'"

DISK_NAME="$(gcloud compute instances describe "$VM_NAME" \
  --zone="$ZONE" \
  --format='get(disks[0].source.basename())')"

VM_IP="$(gcloud compute instances describe "$VM_NAME" \
  --zone="$ZONE" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')"

ADDRESS_NAME="$(gcloud compute addresses list \
  --regions="$REGION" \
  --filter="address=${VM_IP}" \
  --format='get(name)')"

echo "==> VM:        $VM_NAME"
echo "==> Boot disk: $DISK_NAME"
echo "==> Static IP: $ADDRESS_NAME ($VM_IP)"

echo "==> Deleting VM but keeping boot disk"
gcloud compute instances delete "$VM_NAME" \
  --zone="$ZONE" \
  --keep-disks=boot \
  --quiet

echo "==> Deleting boot disk"
gcloud compute disks delete "$DISK_NAME" \
  --zone="$ZONE" \
  --quiet

echo "==> Releasing static IP"
gcloud compute addresses delete "$ADDRESS_NAME" \
  --region="$REGION" \
  --quiet

echo "Done. Snapshots and GCS backups were not touched."