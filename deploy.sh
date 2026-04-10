#!/bin/sh
sudo systemctl stop traccar
sudo cp -a /opt/traccar/web /opt/traccar/web.backup.$(date +%F-%H%M%S)
sudo rsync -av --delete ~/traccar-web-build/ /opt/traccar/web/
sudo systemctl start traccar