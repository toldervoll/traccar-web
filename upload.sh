#!/bin/sh
set -e
npm run build
gcloud compute ssh traccar-vm --zone=europe-north1-b --command="rm -rf ~/traccar-web-build && mkdir -p ~/traccar-web-build"
gcloud compute scp --recurse ./build/* traccar-vm:~/traccar-web-build/ --zone=europe-north1-b
