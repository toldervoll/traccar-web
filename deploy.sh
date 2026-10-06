#!/bin/sh
# Builds the web app, uploads it and installs it on the live server.
# The install restarts Traccar, which logs out every user.
#
# Usage: ./deploy.sh
# Set DEPLOY_ACCOUNT to use another gcloud account than the active one:
#   DEPLOY_ACCOUNT=me@example.com ./deploy.sh
set -e
cd "$(dirname "$0")"

if [ -n "$DEPLOY_ACCOUNT" ]; then
  export CLOUDSDK_CORE_ACCOUNT="$DEPLOY_ACCOUNT"
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "The working tree has uncommitted changes. Commit or stash them first." >&2
  exit 1
fi
echo "Deploying $(git rev-parse --abbrev-ref HEAD) at $(git log -1 --format='%h %s')"

npm test
npm run lint
./upload.sh

gcloud compute ssh traccar-vm --zone=europe-north1-b --project=koredu-traccar --command='
  set -e
  test -f ~/traccar-web-build/index.html
  sudo systemctl stop traccar
  sudo cp -a /opt/traccar/web /opt/traccar/web.backup.$(date +%F-%H%M%S)
  sudo rsync -a --delete ~/traccar-web-build/ /opt/traccar/web/
  sudo systemctl start traccar
  systemctl is-active traccar
'

echo "Deployed. Every user is logged out and must log in again."
