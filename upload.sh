#!/bin/sh
npm run build
gcloud compute scp --recurse ./build traccar-vm:~/traccar-web-build --zone=europe-north1-b
