#!/bin/sh

dev="LABEL=DOORED"
mnt="/mnt/data"
backup="$mnt/backup"
dir="$backup/$(date +%Y-%m-%d_%H.%M.%S)"

log="/var/log/doored"
lib="/var/lib/doored"

mkdir -p "$mnt"
mount "$dev" "$mnt"

mkdir -p "$dir"

cp --preserve=timestamps "$lib/doored.db" "$dir"

umount "$mnt"
