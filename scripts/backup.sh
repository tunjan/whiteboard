#!/bin/sh
# Back up a server run with `docker compose --profile app`: the database and
# the uploads volume (images, documents, music), which boards reference by
# hash. Take both at the same moment and restore them together.
#
#   scripts/backup.sh [dir]        # default ./backups
#
# Nightly from cron:  0 3 * * * cd /srv/whiteboard && scripts/backup.sh
# ponytail: keeps the last 14 sets on this machine only; copy them off it too.
set -eu
dir=${1:-backups}
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "$dir"
docker compose exec -T postgres pg_dump -U whiteboard -Fc whiteboard > "$dir/db-$stamp.dump"
docker compose run --rm -T --no-deps -v "$(pwd)/$dir:/backup" --entrypoint tar app \
  czf "/backup/data-$stamp.tgz" -C /app/server data
ls -1t "$dir"/db-*.dump | tail -n +15 | xargs -r rm --
ls -1t "$dir"/data-*.tgz | tail -n +15 | xargs -r rm --
echo "Backed up to $dir/db-$stamp.dump and $dir/data-$stamp.tgz"
